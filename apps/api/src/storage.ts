import { canonicalize, validateRecord, type DailyRecord } from '@openbook/shared';

/**
 * R2 上の日次レコード・生応答・月次クローズ記録の保存規約。
 *
 * 保存されたバイト列がそのままハッシュ刻印の対象かつ公開物になるため、
 * 取得時に再直列化してはならない。詳細は specs/snapshot-storage/spec.md を参照。
 */

/** 生応答に含まれてはならない項目名（小文字で比較する）。 */
const CREDENTIAL_KEYS = ['authorization', 'x-api-key', 'apikey', 'api_key', 'token', 'secret'];

/**
 * 日次レコードのキーを対象日とリビジョン番号から導出する。
 *
 * @param date 対象日（YYYY-MM-DD 形式）
 * @param revision リビジョン番号（1 始まり）
 * @returns R2 のオブジェクトキー
 */
export function recordKey(date: string, revision: number): string {
  return `records/${date}/${String(revision).padStart(3, '0')}.json`;
}

/**
 * 生応答のキーを対象日と取得元から導出する。
 *
 * @param date 対象日（YYYY-MM-DD 形式）
 * @param source 取得元の識別子
 * @returns R2 のオブジェクトキー
 */
export function rawKey(date: string, source: string): string {
  return `raw/${date}/${source}.json`;
}

/**
 * 月次クローズ記録のキーを対象月から導出する。
 *
 * @param month 対象月（YYYY-MM 形式）
 * @returns R2 のオブジェクトキー
 */
export function closeKey(month: string): string {
  return `close/${month}.json`;
}

/** 月次クローズの記録内容。 */
export interface CloseRecord {
  /** 対象月（YYYY-MM 形式）。 */
  month: string;
  /** クローズした時刻（RFC 3339）。 */
  closedAt: string;
  /** 対象月の各日の最終リビジョン番号。 */
  finalRevisions: Record<string, number>;
  /** 遡及制限により再収集を試みなかった取得元と対象日。 */
  skipped?: { source: string; dates: string[] }[];
}

/**
 * 指定の月がクローズ済みかを判定する。
 *
 * @param bucket 保存先の R2 バケット
 * @param month 対象月（YYYY-MM 形式）
 * @returns クローズ済みなら true
 */
export async function isMonthClosed(bucket: R2Bucket, month: string): Promise<boolean> {
  return (await bucket.head(closeKey(month))) !== null;
}

/**
 * 月次クローズを記録する。
 *
 * この記録の存在がクローズ済み判定の根拠となり、以降その月への書き込みは拒否される。
 *
 * @param bucket 保存先の R2 バケット
 * @param month 対象月（YYYY-MM 形式）
 * @param detail クローズの内容
 * @returns 保存した記録
 */
export async function closeMonth(
  bucket: R2Bucket,
  month: string,
  detail: Omit<CloseRecord, 'month' | 'finalRevisions'> &
    Partial<Pick<CloseRecord, 'finalRevisions'>>,
): Promise<CloseRecord> {
  const body: CloseRecord = {
    month,
    finalRevisions: detail.finalRevisions ?? {},
    closedAt: detail.closedAt,
    ...(detail.skipped === undefined ? {} : { skipped: detail.skipped }),
  };

  await bucket.put(closeKey(month), canonicalize(body));
  return body;
}

/**
 * 既に存在するキーへの書き込みを拒否しつつ保存する。
 *
 * 条件付き書き込み（onlyIf）が権威ある判定であり、これ単独で正しく動作することは
 * test/conditional-put.test.ts で検証済み（design.md の決定 2 が挙げた既知の不具合は
 * 再現しなかった）。先行する head での確認は、本番の R2 で条件付き書き込みが
 * 期待どおり動かなかった場合に備えた保険であり、判定の根拠ではない。
 *
 * @param bucket 保存先の R2 バケット
 * @param key オブジェクトキー
 * @param body 保存するバイト列
 * @throws {Error} キーが既に存在する場合
 */
async function putIfAbsent(bucket: R2Bucket, key: string, body: Uint8Array): Promise<void> {
  if ((await bucket.head(key)) !== null) {
    throw new Error(`キーは既に存在します: ${key}`);
  }

  const written = await bucket.put(key, body, {
    onlyIf: { etagDoesNotMatch: '*' },
  });

  if (written === null) {
    throw new Error(`キーは既に存在します: ${key}`);
  }
}

/**
 * 日次レコードを保存する。
 *
 * 検証を通過し、対象月がクローズされておらず、同じキーが存在しない場合にのみ保存する。
 *
 * @param bucket 保存先の R2 バケット
 * @param record 保存するレコード
 * @returns 保存したオブジェクトキー
 * @throws {Error} 検証違反、クローズ済み月、キー重複、訂正理由の欠落のいずれか
 */
export async function putRecord(bucket: R2Bucket, record: DailyRecord): Promise<string> {
  const violations = validateRecord(record);
  if (violations.length > 0) {
    throw new Error(`レコードが不正です: ${violations.join(' / ')}`);
  }

  if (record.revision > 1 && record.correction === undefined) {
    throw new Error('リビジョン 2 以降には訂正理由が必要です');
  }

  const month = record.date.slice(0, 7);
  if (await isMonthClosed(bucket, month)) {
    throw new Error(`${month} はクローズ済みのため書き込めません`);
  }

  const key = recordKey(record.date, record.revision);
  await putIfAbsent(bucket, key, canonicalize(record));

  return key;
}

/**
 * 生のプロバイダ応答を保存する。
 *
 * 認証情報が含まれていないことを確認してから保存する。
 *
 * @param bucket 保存先の R2 バケット
 * @param date 対象日（YYYY-MM-DD 形式）
 * @param source 取得元の識別子
 * @param body 応答本文
 * @throws {Error} 応答に認証情報が含まれる場合
 */
export async function putRaw(
  bucket: R2Bucket,
  date: string,
  source: string,
  body: unknown,
): Promise<void> {
  const serialized = JSON.stringify(body);
  const found = CREDENTIAL_KEYS.find((key) =>
    serialized.toLowerCase().includes(`"${key}"`),
  );

  if (found !== undefined) {
    throw new Error(`生応答に認証情報が含まれています: ${found}`);
  }

  await bucket.put(rawKey(date, source), serialized);
}

/**
 * 指定日のレコードを取得する。
 *
 * 保存されたバイト列をそのまま返す。再直列化すると、公開されるバイト列が
 * ハッシュ対象と一致しなくなる可能性がある。
 *
 * @param bucket 取得元の R2 バケット
 * @param date 対象日（YYYY-MM-DD 形式）
 * @param revision リビジョン番号。省略時は最新
 * @returns 保存されたバイト列。存在しない場合は null
 */
export async function getRecord(
  bucket: R2Bucket,
  date: string,
  revision?: number,
): Promise<Uint8Array | null> {
  const key =
    revision === undefined ? await latestKey(bucket, date) : recordKey(date, revision);

  if (key === null) {
    return null;
  }

  const object = await bucket.get(key);
  return object === null ? null : new Uint8Array(await object.arrayBuffer());
}

/**
 * 指定日の最新リビジョンのキーを求める。
 *
 * @param bucket 取得元の R2 バケット
 * @param date 対象日（YYYY-MM-DD 形式）
 * @returns 最新リビジョンのキー。レコードが存在しない場合は null
 */
async function latestKey(bucket: R2Bucket, date: string): Promise<string | null> {
  const listed = await bucket.list({ prefix: `records/${date}/` });
  const keys = listed.objects.map((object) => object.key).sort();

  return keys.length === 0 ? null : keys[keys.length - 1]!;
}

/** 期間取得の結果 1 件。 */
export interface StoredRecord {
  /** 対象日（YYYY-MM-DD 形式）。 */
  date: string;
  /** 保存されたバイト列。 */
  bytes: Uint8Array;
}

/**
 * 期間内のレコードを日付昇順で取得する。
 *
 * 存在しない日は結果に含めない。
 *
 * @param bucket 取得元の R2 バケット
 * @param from 開始日（YYYY-MM-DD 形式、含む）
 * @param to 終了日（YYYY-MM-DD 形式、含む）
 * @returns 期間内に存在するレコード
 */
export async function listRecords(
  bucket: R2Bucket,
  from: string,
  to: string,
): Promise<StoredRecord[]> {
  const listed = await bucket.list({ prefix: 'records/' });
  const dates = [
    ...new Set(
      listed.objects
        .map((object) => object.key.split('/')[1])
        .filter((date): date is string => date !== undefined && date >= from && date <= to),
    ),
  ].sort();

  const results: StoredRecord[] = [];
  for (const date of dates) {
    const bytes = await getRecord(bucket, date);
    if (bytes !== null) {
      results.push({ date, bytes });
    }
  }

  return results;
}
