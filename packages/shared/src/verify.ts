import { sha256Hex, type HexHash } from './hash.js';
import { isCalendarDate } from './validate.js';

/**
 * 公開された日次レコードのバイト列を、チェーン上の刻印と照らして分類する。
 *
 * 判定に用いるのは、渡されたバイト列とチェーン上の値だけとする。運営者が保存する
 * 刻印の結果や API の応答を根拠にすると、運営者が記録ごと書き換えた場合に改ざんを
 * 検知できない。詳細は specs/anchor-verification/spec.md を参照。
 */

/** 未刻印を表すハッシュ。コントラクトは刻印としてこの値を受け付けない。 */
export const ZERO_HASH: HexHash = `0x${'0'.repeat(64)}`;

/** 刻印のコントラクトへの照会。 */
export interface AnchorReader {
  /** 照会先のチェーン ID。 */
  chainId: number;
  /** 照会先のコントラクトのアドレス。 */
  contractAddress: string;
  /**
   * 対象日とリビジョンに刻印されたハッシュを返す。未刻印の場合は ZERO_HASH。
   *
   * @param date 対象日（YYYYMMDD 形式の整数）
   * @param revision リビジョン番号
   */
  hashOf(date: number, revision: number): Promise<HexHash>;
  /**
   * 対象日に刻印された最大のリビジョン番号を返す。刻印がなければ 0。
   *
   * @param date 対象日（YYYYMMDD 形式の整数）
   */
  latestRevisionOf(date: number): Promise<number>;
}

/** 検証の分類。 */
export type VerificationStatus =
  /** その対象日の現在の値として刻印されている。 */
  | 'current'
  /** 刻印後に訂正された、過去の値である。 */
  | 'superseded'
  /** 刻印による証明がない。 */
  | 'unanchored'
  /** 刻印後にバイト列が変わっている。 */
  | 'mismatched';

/** 判定の根拠。 */
export interface VerificationEvidence {
  /** バイト列が示す対象日（YYYY-MM-DD 形式）。 */
  date: string;
  /** バイト列が示すリビジョン番号。 */
  revision: number;
  /** バイト列から算出したハッシュ。 */
  computedHash: HexHash;
  /** チェーン上に刻印されたハッシュ。未刻印の場合は ZERO_HASH。 */
  anchoredHash: HexHash;
  /** 対象日に刻印された最大のリビジョン番号。 */
  latestRevision: number;
  /** 照会したコントラクトのアドレス。 */
  contractAddress: string;
  /** 照会したチェーン ID。 */
  chainId: number;
}

/** 検証の結果。分類できない場合は理由のみを返す。 */
export type VerificationResult =
  | { kind: 'classified'; status: VerificationStatus; evidence: VerificationEvidence }
  | { kind: 'unverifiable'; reason: string };

/** バイト列から読み取った対象日とリビジョン番号。 */
interface RecordKey {
  date: string;
  revision: number;
}

/**
 * バイト列から対象日とリビジョン番号を読み取る。
 *
 * レコード全体の妥当性検証はかけない。改ざんされたバイト列が妥当性検証で弾かれると、
 * 「不一致」ではなく「検証できない」と判定され、改ざんの検知という目的に反する。
 *
 * @param bytes 対象のバイト列
 * @returns 読み取り結果、または読み取れない理由
 */
function readKey(bytes: Uint8Array): RecordKey | { reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { reason: 'JSON として解析できません' };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { reason: 'JSON として解析できますが、レコードの形ではありません' };
  }

  const { date, revision } = parsed as { date?: unknown; revision?: unknown };

  if (typeof date !== 'string' || !isCalendarDate(date)) {
    return { reason: '対象日を読み取れません' };
  }

  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 1) {
    return { reason: 'リビジョン番号を読み取れません' };
  }

  return { date, revision };
}

/**
 * 対象日を YYYYMMDD 形式の整数に直す。コントラクトはこの形式で刻印を保持する。
 *
 * @param date 対象日（YYYY-MM-DD 形式）
 * @returns YYYYMMDD 形式の整数
 */
function toDateNumber(date: string): number {
  return Number(date.replaceAll('-', ''));
}

/**
 * 日次レコードのバイト列を検証し、分類と判定の根拠を返す。
 *
 * ハッシュは受け取ったバイト列そのものから算出する。解析して直列化し直すと、
 * 公開されたバイト列とは別のものを検証することになる。
 *
 * 刻印があって算出値と一致する場合、リビジョン番号が最大であれば現行、
 * それより小さければ履歴とする。コントラクトがリビジョンの単調増加を保証するため、
 * 刻印済みのリビジョンが最大を超えることはない。
 *
 * @param bytes 検証する日次レコードのバイト列
 * @param reader 刻印のコントラクトへの照会
 * @returns 分類と根拠、または検証できない理由
 */
export async function verifyAnchoredRecord(
  bytes: Uint8Array,
  reader: AnchorReader,
): Promise<VerificationResult> {
  const key = readKey(bytes);
  if ('reason' in key) {
    return { kind: 'unverifiable', reason: key.reason };
  }

  const dateNumber = toDateNumber(key.date);
  const computedHash = await sha256Hex(bytes);
  const anchoredHash = await reader.hashOf(dateNumber, key.revision);
  const latestRevision = await reader.latestRevisionOf(dateNumber);

  const evidence: VerificationEvidence = {
    date: key.date,
    revision: key.revision,
    computedHash,
    anchoredHash,
    latestRevision,
    contractAddress: reader.contractAddress,
    chainId: reader.chainId,
  };

  if (anchoredHash === ZERO_HASH) {
    return { kind: 'classified', status: 'unanchored', evidence };
  }

  if (anchoredHash.toLowerCase() !== computedHash.toLowerCase()) {
    return { kind: 'classified', status: 'mismatched', evidence };
  }

  return {
    kind: 'classified',
    status: key.revision < latestRevision ? 'superseded' : 'current',
    evidence,
  };
}
