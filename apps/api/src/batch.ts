import {
  canonicalize,
  convertToJpy,
  createRecord,
  type DailyRecord,
  type Entry,
  type ExchangeRate,
  type IncompleteItem,
} from '@openbook/shared';

import { writeRun, type SourceResult } from './runlog.js';
import { getRecord, isMonthClosed, putRaw, putRecord } from './storage.js';

/**
 * 日次バッチの実行。
 *
 * 収集ソースそのものは後続チェンジで追加されるため、ここではソースの登録・実行・
 * 記録・再実行の仕組みだけを定める。詳細は specs/daily-batch/spec.md を参照。
 */

/** 収集ソースが返す内容。 */
export interface CollectionResult {
  /** 費用エントリ。 */
  costs: Entry[];
  /** 収益エントリ。 */
  revenues: Entry[];
  /** 監査と再計算のために保存する生応答。 */
  raw?: unknown;
}

/** 対象日のデータを取得する収集ソース。 */
export interface CollectionSource {
  /** 取得元の識別子。 */
  id: string;
  /** 提供元が後から値を改訂しうるか。 */
  revisable: boolean;
  /** 対象日のエントリを取得する。 */
  collect(date: string): Promise<CollectionResult> | CollectionResult;
  /**
   * 対象日を遡って取得できるか。
   * 取得元ごとに遡及可能な期間が異なるため、月次クローズの再収集可否を判定する。
   */
  canCollect?(date: string, now: string): boolean;
}

/** 日次実行の依存。テストから差し替えられるようにする。 */
export interface RunOptions {
  /** 実行時刻として記録する値（RFC 3339）。 */
  now: string;
  /** 対象日の為替レートを取得する。取得できない場合は undefined を返す。 */
  fetchRate: (date: string) => Promise<ExchangeRate | undefined>;
}

/**
 * 収集ソースをすべて実行し、成功分のエントリと失敗の記録を集める。
 *
 * @param sources 実行する収集ソース
 * @param date 対象日
 * @param bucket 生応答の保存先
 * @returns 収集結果
 */
async function collectAll(
  sources: readonly CollectionSource[],
  date: string,
  bucket: R2Bucket,
): Promise<{
  costs: Entry[];
  revenues: Entry[];
  incomplete: IncompleteItem[];
  results: SourceResult[];
}> {
  const costs: Entry[] = [];
  const revenues: Entry[] = [];
  const incomplete: IncompleteItem[] = [];
  const results: SourceResult[] = [];

  for (const source of sources) {
    try {
      const collected = await source.collect(date);
      costs.push(...collected.costs);
      revenues.push(...collected.revenues);

      if (collected.raw !== undefined) {
        await putRaw(bucket, date, source.id, collected.raw);
      }
      results.push({ id: source.id, ok: true });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      // 欠測は 0 円のエントリにせず、取得できなかった事実として残す。
      incomplete.push({ kind: 'source', id: source.id, reason });
      results.push({ id: source.id, ok: false, reason });
    }
  }

  return { costs, revenues, incomplete, results };
}

/**
 * 保存済みの最新リビジョンを読み出す。
 *
 * @param bucket 取得元の R2 バケット
 * @param date 対象日
 * @returns 最新リビジョンのレコード。存在しない場合は null
 */
async function readLatest(bucket: R2Bucket, date: string): Promise<DailyRecord | null> {
  const bytes = await getRecord(bucket, date);
  return bytes === null
    ? null
    : (JSON.parse(new TextDecoder().decode(bytes)) as DailyRecord);
}

/**
 * 生成時刻・訂正情報・為替レートの取得時刻を除いた内容が既存リビジョンと同一かを判定する。
 *
 * 実行のたびに変わる項目を比較対象から外さないと、内容が変わっていなくても
 * 差分ありと判定され、リビジョンが際限なく増える。レート値と公表日は比較対象に残す。
 *
 * @param a 比較対象のレコード
 * @param b 比較対象のレコード
 * @returns 内容が同一なら true
 */
function hasSameContent(a: DailyRecord, b: DailyRecord): boolean {
  const strip = (record: DailyRecord): unknown => {
    const { generatedAt: _generatedAt, revision: _revision, correction: _correction, ...rest } = record;
    const exchangeRates = rest.exchangeRates.map(({ fetchedAt: _fetchedAt, ...rate }) => rate);
    return { ...rest, exchangeRates };
  };

  const decoder = new TextDecoder();
  return decoder.decode(canonicalize(strip(a))) === decoder.decode(canonicalize(strip(b)));
}

/** 遡及可能期間外で、既存のレコードにも値がない収集ソースの欠測理由。 */
const OUT_OF_REACH_REASON = '遡及可能期間外のため取得できません';

/**
 * エントリから換算結果（`amountJpy` と `exchangeRate`）を取り除く。
 *
 * @param entry 換算済みのエントリ
 * @returns 換算前のエントリ
 */
function withoutConversion(entry: Entry): Entry {
  const { amountJpy: _amountJpy, exchangeRate: _exchangeRate, ...rest } = entry;
  return rest;
}

/**
 * 既存のレコードから、指定した収集ソースのエントリと欠測の記録を取り出す。
 *
 * 換算結果は取り除き、今回の実行で取得したレートで換算し直す。1 レコード内の
 * 同一通貨ペアには同一のレートを適用する規則を保つため。
 *
 * 既存のレコードに値がないソースは、取得できなかった事実を欠測として残す。
 * 何も記録しないと、そのソースが費用の対象から外れたように見える。
 *
 * @param existing 既存の最新リビジョン。存在しない場合は null
 * @param sourceIds 引き継ぐ収集ソースの識別子
 * @returns 引き継ぐエントリと欠測の記録
 */
function retainFromExisting(
  existing: DailyRecord | null,
  sourceIds: readonly string[],
): { costs: Entry[]; revenues: Entry[]; incomplete: IncompleteItem[] } {
  const costs: Entry[] = [];
  const revenues: Entry[] = [];
  const incomplete: IncompleteItem[] = [];

  for (const id of sourceIds) {
    const retainedCosts = (existing?.costs ?? []).filter((entry) => entry.source === id);
    const retainedRevenues = (existing?.revenues ?? []).filter((entry) => entry.source === id);
    const retainedIncomplete = (existing?.incomplete ?? []).filter(
      (item) => item.kind === 'source' && item.id === id,
    );

    const hasNothingToRetain =
      retainedCosts.length === 0 &&
      retainedRevenues.length === 0 &&
      retainedIncomplete.length === 0;
    if (hasNothingToRetain) {
      incomplete.push({ kind: 'source', id, reason: OUT_OF_REACH_REASON });
      continue;
    }

    costs.push(...retainedCosts.map(withoutConversion));
    revenues.push(...retainedRevenues.map(withoutConversion));
    incomplete.push(...retainedIncomplete);
  }

  return { costs, revenues, incomplete };
}

/**
 * 対象日の収集を実行し、必要ならレコードを保存する。
 *
 * すべての収集ソースが失敗した場合はレコードを生成しない。欠測を 0 円として
 * 記録すると、実態と異なる数値が公開されるため。
 *
 * 遡及できないため呼び出さなかった収集ソースは、既存のレコードにあるエントリと
 * 欠測の記録を引き継ぐ。引き継がないと、その値が欠測としても記録されないまま
 * 公開値から消える。引き継ぐ値がない場合は欠測として記録する。
 *
 * @param bucket 保存先の R2 バケット
 * @param sources 実行する収集ソース
 * @param date 対象日（YYYY-MM-DD 形式）
 * @param options 実行の依存
 * @param retainedSourceIds 呼び出さずに既存の値を引き継ぐ収集ソースの識別子
 * @returns 保存したレコード。保存しなかった場合は null
 * @throws {Error} 対象月がクローズ済みの場合
 */
export async function runDaily(
  bucket: R2Bucket,
  sources: readonly CollectionSource[],
  date: string,
  options: RunOptions,
  retainedSourceIds: readonly string[] = [],
): Promise<DailyRecord | null> {
  const month = date.slice(0, 7);
  if (await isMonthClosed(bucket, month)) {
    throw new Error(`${month} はクローズ済みのため実行できません`);
  }

  const startedAt = options.now;
  const collected = await collectAll(sources, date, bucket);

  // 収集ソースが 1 件以上あって全滅した場合のみ、レコードを作らない。
  const allFailed = sources.length > 0 && collected.results.every((result) => !result.ok);
  if (allFailed) {
    await writeRun(bucket, {
      date,
      startedAt,
      finishedAt: options.now,
      ok: false,
      sources: collected.results,
    });
    return null;
  }

  const existing = await readLatest(bucket, date);
  const retained = retainFromExisting(existing, retainedSourceIds);

  const costs = [...collected.costs, ...retained.costs];
  const revenues = [...collected.revenues, ...retained.revenues];
  const incomplete = [...collected.incomplete, ...retained.incomplete];

  let rate: ExchangeRate | undefined;
  const needsRate = [...costs, ...revenues].some((entry) => entry.currency !== 'JPY');

  if (needsRate) {
    rate = await options.fetchRate(date);
    if (rate === undefined) {
      incomplete.push({
        kind: 'exchange-rate',
        id: 'USD/JPY',
        reason: '為替レートを取得できませんでした',
      });
    }
  }

  const revision = existing === null ? 1 : existing.revision + 1;

  const candidate = createRecord({
    date,
    revision,
    generatedAt: options.now,
    costs: costs.map((entry) => convertToJpy(entry, rate)),
    revenues: revenues.map((entry) => convertToJpy(entry, rate)),
    incomplete,
    exchangeRates: rate === undefined ? [] : [rate],
    ...(existing === null
      ? {}
      : { correction: { supersedes: existing.revision, reason: '再収集による更新' } }),
  });

  // 内容が変わっていなければリビジョンを増やさない。
  if (existing !== null && hasSameContent(existing, candidate)) {
    await writeRun(bucket, {
      date,
      startedAt,
      finishedAt: options.now,
      ok: true,
      sources: collected.results,
      revision: existing.revision,
    });
    return existing;
  }

  await putRecord(bucket, candidate);
  await writeRun(bucket, {
    date,
    startedAt,
    finishedAt: options.now,
    ok: true,
    sources: collected.results,
    revision,
  });

  return candidate;
}
