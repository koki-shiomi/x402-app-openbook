import { describe, expect, it, vi } from 'vitest';

import { createAdmobSource } from '../../src/sources/admob.js';
import type { AdmobConfig } from '../../src/sources/config.js';

const CONFIG: AdmobConfig = {
  clientId: 'client-1',
  clientSecret: 'secret-1',
  refreshToken: 'refresh-1',
  publisherId: 'pub-1',
  appId: 'ca-app-pub-1~2',
};

/** レポートの 1 行と、その行が属するアプリ。実測の応答の形に合わせる。 */
interface StubRow {
  app: string;
  format: string;
  micros: string;
}

/**
 * レポートの行を作る。
 *
 * @param format 広告フォーマット
 * @param micros マイクロ単位の推定収益
 * @param app 所属するアプリ（既定は対象アプリ）
 * @returns スタブ用の行
 */
function row(format: string, micros: string, app: string = CONFIG.appId): StubRow {
  return { app, format, micros };
}

/** 呼び出しの記録。 */
interface Call {
  url: string;
  headers: Record<string, string>;
  body?: Record<string, unknown>;
}

/** スタブの設定。 */
interface StubOptions {
  rows?: StubRow[];
  reportingTimeZone?: string;
  accountCurrency?: string;
  headerCurrency?: string;
  token?: { status: number; body: unknown };
}

/**
 * OAuth・アカウント情報・レポートの応答を返すフェッチ関数を作る。
 *
 * @param options スタブの設定
 * @returns フェッチ関数と呼び出しの記録
 */
function stubFetch(options: StubOptions = {}) {
  const calls: Call[] = [];
  const currency = options.accountCurrency ?? 'JPY';
  const rows = options.rows ?? [];

  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const rawBody = init?.body === undefined ? undefined : String(init.body);
    const call: Call = {
      url,
      headers: (init?.headers ?? {}) as Record<string, string>,
    };
    if (rawBody !== undefined && url.includes('networkReport')) {
      call.body = JSON.parse(rawBody) as Record<string, unknown>;
    }
    calls.push(call);

    if (url.includes('oauth2.googleapis.com/token')) {
      const token = options.token ?? {
        status: 200,
        body: { access_token: 'at-1', expires_in: 3599, token_type: 'Bearer' },
      };
      return new Response(JSON.stringify(token.body), { status: token.status });
    }

    if (url.includes('networkReport:generate')) {
      const spec = (call.body?.['reportSpec'] ?? {}) as Record<string, unknown>;
      const filters = (spec['dimensionFilters'] ?? []) as {
        dimension?: string;
        matchesAny?: { values?: string[] };
      }[];
      const apps = filters.find((filter) => filter.dimension === 'APP')?.matchesAny?.values;
      const matched = apps === undefined ? rows : rows.filter((item) => apps.includes(item.app));

      return new Response(
        JSON.stringify([
          {
            header: {
              dateRange: {},
              localizationSettings: { currencyCode: options.headerCurrency ?? currency },
            },
          },
          ...matched.map((item) => ({
            row: {
              dimensionValues: {
                DATE: { value: '20260908' },
                FORMAT: { value: item.format },
              },
              metricValues: { ESTIMATED_EARNINGS: { microsValue: item.micros } },
            },
          })),
          { footer: { matchingRowCount: String(matched.length) } },
        ]),
        { status: 200 },
      );
    }

    if (url.includes('/accounts/')) {
      return new Response(
        JSON.stringify({
          name: `accounts/${CONFIG.publisherId}`,
          publisherId: CONFIG.publisherId,
          reportingTimeZone: options.reportingTimeZone ?? 'Asia/Tokyo',
          currencyCode: currency,
        }),
        { status: 200 },
      );
    }

    return new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;

  return { fetchImpl, calls };
}

describe('アクセストークンの取得', () => {
  it('リフレッシュトークンからアクセストークンを取得して API を呼ぶ', async () => {
    const { fetchImpl, calls } = stubFetch({ rows: [row('banner', '208376')] });
    const source = createAdmobSource(CONFIG, { fetchImpl });

    await source.collect('2026-09-08');

    const token = calls.find((call) => call.url.includes('oauth2.googleapis.com/token'));
    expect(token).toBeDefined();
    const admobCalls = calls.filter((call) => call.url.includes('admob.googleapis.com'));
    expect(admobCalls.length).toBeGreaterThan(0);
    for (const call of admobCalls) {
      expect(call.headers['authorization']).toBe('Bearer at-1');
    }
  });

  it('同一の収集ソース内ではアクセストークンが再利用される', async () => {
    const { fetchImpl, calls } = stubFetch({ rows: [row('banner', '208376')] });
    const source = createAdmobSource(CONFIG, { fetchImpl });

    await source.collect('2026-09-08');
    await source.collect('2026-09-09');

    const tokenCalls = calls.filter((call) => call.url.includes('oauth2.googleapis.com/token'));
    expect(tokenCalls).toHaveLength(1);
  });

  it('invalid_grant なら再発行が必要な旨を含む理由で失敗する', async () => {
    const { fetchImpl } = stubFetch({
      token: { status: 400, body: { error: 'invalid_grant', error_description: 'expired' } },
    });
    const source = createAdmobSource(CONFIG, { fetchImpl });

    await expect(source.collect('2026-09-08')).rejects.toThrow(/再発行/);
  });

  it('その他の失敗は HTTP ステータスを理由に含める', async () => {
    const { fetchImpl } = stubFetch({ token: { status: 500, body: { error: 'internal' } } });
    const source = createAdmobSource(CONFIG, { fetchImpl });

    await expect(source.collect('2026-09-08')).rejects.toThrow(/HTTP 500/);
  });
});

describe('収益エントリへの変換', () => {
  it('広告フォーマットごとに 1 件のエントリになる', async () => {
    const { fetchImpl } = stubFetch({
      rows: [row('banner', '208376'), row('interstitial', '7613654')],
    });
    const source = createAdmobSource(CONFIG, { fetchImpl });

    const result = await source.collect('2026-09-08');

    expect(result.revenues.map((entry) => entry.category)).toEqual(['banner', 'interstitial']);
    expect(result.costs).toEqual([]);
  });

  it('取得方式が measured、改訂可能性が真になる', async () => {
    const { fetchImpl } = stubFetch({ rows: [row('banner', '208376')] });
    const source = createAdmobSource(CONFIG, { fetchImpl });

    const [entry] = (await source.collect('2026-09-08')).revenues;

    expect(entry).toMatchObject({
      source: 'admob',
      acquisition: 'measured',
      revisable: true,
    });
  });
});

describe('要求の内容', () => {
  it('対象日 1 日の期間・DATE と FORMAT・推定収益を指定する', async () => {
    const { fetchImpl, calls } = stubFetch();
    const source = createAdmobSource(CONFIG, { fetchImpl });

    await source.collect('2026-09-08');

    const spec = calls.find((call) => call.url.includes('networkReport'))?.body?.[
      'reportSpec'
    ] as Record<string, unknown>;
    expect(spec['dateRange']).toEqual({
      startDate: { year: 2026, month: 9, day: 8 },
      endDate: { year: 2026, month: 9, day: 8 },
    });
    expect(spec['dimensions']).toEqual(['DATE', 'FORMAT']);
    expect(spec['metrics']).toEqual(['ESTIMATED_EARNINGS']);
  });

  it('対象アプリで絞り込む', async () => {
    const { fetchImpl, calls } = stubFetch();
    const source = createAdmobSource(CONFIG, { fetchImpl });

    await source.collect('2026-09-08');

    const spec = calls.find((call) => call.url.includes('networkReport'))?.body?.[
      'reportSpec'
    ] as Record<string, unknown>;
    expect(spec['dimensionFilters']).toEqual([
      { dimension: 'APP', matchesAny: { values: [CONFIG.appId] } },
    ]);
  });

  it('timeZone と localizationSettings を指定しない', async () => {
    const { fetchImpl, calls } = stubFetch();
    const source = createAdmobSource(CONFIG, { fetchImpl });

    await source.collect('2026-09-08');

    const spec = calls.find((call) => call.url.includes('networkReport'))?.body?.[
      'reportSpec'
    ] as Record<string, unknown>;
    expect(spec['timeZone']).toBeUndefined();
    expect(spec['localizationSettings']).toBeUndefined();
  });
});

describe('マイクロ単位の変換', () => {
  it('JPY の 12345678 マイクロが 12.35 になる', async () => {
    const { fetchImpl } = stubFetch({ rows: [row('banner', '12345678')] });
    const source = createAdmobSource(CONFIG, { fetchImpl });

    const [entry] = (await source.collect('2026-09-08')).revenues;

    expect(entry).toMatchObject({ currency: 'JPY', amount: '12.35' });
  });

  it('USD の 6500000 マイクロが 6.500000 になる', async () => {
    const { fetchImpl } = stubFetch({
      rows: [row('banner', '6500000')],
      accountCurrency: 'USD',
    });
    const source = createAdmobSource(CONFIG, { fetchImpl });

    const [entry] = (await source.collect('2026-09-08')).revenues;

    expect(entry).toMatchObject({ currency: 'USD', amount: '6.500000' });
  });

  it('浮動小数点数で誤差が出る値も 10 進数として丸められる', async () => {
    const { fetchImpl } = stubFetch({ rows: [row('banner', '1005000')] });
    const source = createAdmobSource(CONFIG, { fetchImpl });

    const [entry] = (await source.collect('2026-09-08')).revenues;

    // 1.005 は 2 進浮動小数点で 1.00499… となるため、丸めると 1.00 になってしまう。
    expect(entry?.amount).toBe('1.01');
  });
});

describe('行がない日', () => {
  it('収益エントリが作られない', async () => {
    const { fetchImpl } = stubFetch({ rows: [] });
    const source = createAdmobSource(CONFIG, { fetchImpl });

    const result = await source.collect('2026-09-08');

    expect(result.revenues).toEqual([]);
    expect(result.costs).toEqual([]);
  });
});

describe('対象アプリの限定', () => {
  it('他のアプリの収益は含まれない', async () => {
    const { fetchImpl } = stubFetch({
      rows: [row('banner', '208376'), row('banner', '999999', 'ca-app-pub-1~9')],
    });
    const source = createAdmobSource(CONFIG, { fetchImpl });

    const result = await source.collect('2026-09-08');

    expect(result.revenues).toHaveLength(1);
    expect(result.revenues[0]?.amount).toBe('0.21');
  });
});

describe('集計タイムゾーンの記録', () => {
  it('アカウントのレポートタイムゾーンが各エントリに記録される', async () => {
    const { fetchImpl } = stubFetch({
      rows: [row('banner', '208376'), row('interstitial', '7613654')],
      reportingTimeZone: 'Asia/Tokyo',
    });
    const source = createAdmobSource(CONFIG, { fetchImpl });

    const result = await source.collect('2026-09-08');

    expect(result.revenues.every((entry) => entry.sourceTimezone === 'Asia/Tokyo')).toBe(true);
  });
});

describe('収益の通貨', () => {
  it('アカウントの通貨が原通貨になる', async () => {
    const { fetchImpl } = stubFetch({ rows: [row('banner', '6500000')], accountCurrency: 'USD' });
    const source = createAdmobSource(CONFIG, { fetchImpl });

    const [entry] = (await source.collect('2026-09-08')).revenues;

    expect(entry?.currency).toBe('USD');
  });

  it('レポートの通貨がアカウントの通貨と異なれば失敗する', async () => {
    const { fetchImpl } = stubFetch({
      rows: [row('banner', '208376')],
      accountCurrency: 'JPY',
      headerCurrency: 'USD',
    });
    const source = createAdmobSource(CONFIG, { fetchImpl });

    await expect(source.collect('2026-09-08')).rejects.toThrow(/通貨/);
  });

  it('JPY・USD 以外の通貨なら失敗する', async () => {
    const { fetchImpl } = stubFetch({
      rows: [row('banner', '208376')],
      accountCurrency: 'EUR',
    });
    const source = createAdmobSource(CONFIG, { fetchImpl });

    await expect(source.collect('2026-09-08')).rejects.toThrow(/通貨/);
  });
});

describe('生応答の保存', () => {
  it('アカウント情報とレポートをまとめて保存対象として返す', async () => {
    const { fetchImpl } = stubFetch({ rows: [row('banner', '208376')] });
    const source = createAdmobSource(CONFIG, { fetchImpl });

    const raw = (await source.collect('2026-09-08')).raw as Record<string, unknown>;

    expect(Object.keys(raw).sort()).toEqual(['account', 'report']);
  });

  it('認証情報を含まない', async () => {
    const { fetchImpl } = stubFetch({ rows: [row('banner', '208376')] });
    const source = createAdmobSource(CONFIG, { fetchImpl });

    const raw = (await source.collect('2026-09-08')).raw;
    const text = JSON.stringify(raw);

    expect(text).not.toContain('at-1');
    expect(text).not.toContain(CONFIG.refreshToken);
    expect(text).not.toContain(CONFIG.clientSecret);
  });
});
