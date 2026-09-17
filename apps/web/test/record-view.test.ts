import { beforeEach, describe, expect, it } from 'vitest';

import type { DailyRecord } from '@openbook/shared';

import { renderRecord } from '../src/record-view.js';

/**
 * 1 日分の明細の表示の確認。
 *
 * 同じ金額でも実測値か宣言値かで意味が異なる。取得方式を示さずに金額だけを
 * 並べると、確からしさの違いが失われる。欠測を 0 円として表示すると、実態と
 * 異なる数値を公開することになる。詳細は specs/public-dashboard/spec.md の
 * 「1 日分の明細の表示」を参照。
 */

const RECORD: DailyRecord = {
  schemaVersion: 1,
  date: '2026-09-14',
  revision: 1,
  generatedAt: '2026-09-15T06:00:02.000Z',
  costs: [
    {
      source: 'claude',
      category: 'usage',
      acquisition: 'measured',
      revisable: false,
      currency: 'USD',
      amount: '1.007100',
      amountJpy: '151.07',
      exchangeRate: { pair: 'USD/JPY', rate: '150.00', publishedOn: '2026-09-13' },
    },
    {
      source: 'resend',
      category: 'plan',
      acquisition: 'estimated',
      revisable: false,
      currency: 'JPY',
      amount: '0.00',
      amountJpy: '0.00',
      basis: { description: '無料プランのため月額 0 円を日割り', plan: 'free' },
    },
  ],
  revenues: [
    {
      source: 'admob',
      category: 'ads',
      acquisition: 'measured',
      revisable: true,
      currency: 'JPY',
      amount: '208.00',
      amountJpy: '208.00',
    },
  ],
  incomplete: [
    { kind: 'source', id: 'supabase', reason: '認証情報が設定されていません' },
  ],
  exchangeRates: [
    {
      pair: 'USD/JPY',
      rate: '150.00',
      provider: 'frankfurter',
      publishedOn: '2026-09-13',
      fetchedAt: '2026-09-15T06:00:01.000Z',
    },
  ],
  totals: { revenueJpy: '208.00', costJpy: '151.07', profitJpy: '56.93', incomplete: true },
};

let container: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.append(container);
});

describe('1 日分の明細', () => {
  it('取得元・取得方式・改訂の可能性が各エントリに示される', () => {
    renderRecord(container, RECORD);

    const claude = container.querySelector('[data-testid="entry"][data-source="claude"]');

    expect(claude?.textContent).toContain('claude');
    expect(claude?.getAttribute('data-acquisition')).toBe('measured');
    expect(claude?.getAttribute('data-revisable')).toBe('false');
  });

  it('提供元が値を改訂しうるエントリが区別される', () => {
    renderRecord(container, RECORD);

    const admob = container.querySelector('[data-testid="entry"][data-source="admob"]');

    expect(admob?.getAttribute('data-revisable')).toBe('true');
  });

  it('原通貨の金額と換算後の金額の双方が示される', () => {
    renderRecord(container, RECORD);

    const claude = container.querySelector('[data-testid="entry"][data-source="claude"]');

    expect(claude?.textContent).toContain('1.007100');
    expect(claude?.textContent).toContain('151.07');
    expect(claude?.textContent).toContain('USD');
  });

  it('適用した為替レートが示される', () => {
    renderRecord(container, RECORD);

    const rates = container.querySelector('[data-testid="exchange-rates"]');

    expect(rates?.textContent).toContain('USD/JPY');
    expect(rates?.textContent).toContain('150.00');
    expect(rates?.textContent).toContain('2026-09-13');
  });

  it('集計値が示される', () => {
    renderRecord(container, RECORD);

    const totals = container.querySelector('[data-testid="totals"]');

    expect(totals?.textContent).toContain('208.00');
    expect(totals?.textContent).toContain('151.07');
    expect(totals?.textContent).toContain('56.93');
  });
});

describe('欠測の表示', () => {
  it('欠測した取得元と理由が示される', () => {
    renderRecord(container, RECORD);

    const incomplete = container.querySelector('[data-testid="incomplete"]');

    expect(incomplete?.textContent).toContain('supabase');
    expect(incomplete?.textContent).toContain('認証情報が設定されていません');
  });

  it('欠測が 0 円として表示されない', () => {
    renderRecord(container, RECORD);

    // 欠測した取得元が、金額を持つエントリとして現れてはならない。
    const asEntry = container.querySelector('[data-testid="entry"][data-source="supabase"]');

    expect(asEntry).toBeNull();
  });

  it('欠測を含むことが集計値に示される', () => {
    renderRecord(container, RECORD);

    const totals = container.querySelector('[data-testid="totals"]');

    expect(totals?.textContent).toContain('欠測');
  });

  it('欠測がなければ欠測の節を出さない', () => {
    renderRecord(container, {
      ...RECORD,
      incomplete: [],
      totals: { ...RECORD.totals, incomplete: false },
    });

    expect(container.querySelector('[data-testid="incomplete"]')).toBeNull();
  });
});
