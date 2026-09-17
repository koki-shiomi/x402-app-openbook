import type { VerificationResult } from '@openbook/shared';

import { compareWithHeaders } from './verification.js';
import type { AnchorHeaders } from './purchase.js';

/**
 * 検証の結果の描画。
 *
 * 結果だけを示しても、利用者は自分で確かめ直せない。算出した値・チェーン上の値・
 * 照会先を示して、手順書どおりに追試できるようにする。
 * 詳細は specs/public-dashboard/spec.md の「取得したバイト列の検証」を参照。
 */

/** 分類の表示名。 */
const STATUS_LABELS: Record<string, string> = {
  current: '現行（この対象日の現在の値として刻印されています）',
  superseded: '履歴（刻印後に訂正された、過去の値です）',
  unanchored: '未刻印（刻印による証明がありません）',
  mismatched: '不一致（刻印後にバイト列が変わっています）',
};

/**
 * 検証の結果を描く。
 *
 * @param target 描画先の要素
 * @param result 検証の結果
 * @param headers API が応答ヘッダで示した刻印の情報
 */
export function renderVerification(
  target: HTMLElement,
  result: VerificationResult,
  headers: AnchorHeaders,
): void {
  const section = document.createElement('section');
  section.dataset['testid'] = 'verification';

  const heading = document.createElement('h3');
  heading.textContent = '検証';
  section.append(heading);

  const status = document.createElement('p');
  status.dataset['testid'] = 'status';

  if (result.kind === 'unverifiable') {
    status.textContent = `検証できません: ${result.reason}`;
    section.append(status);
    target.append(section);
    return;
  }

  status.textContent = STATUS_LABELS[result.status] ?? result.status;
  section.append(status);

  section.append(renderEvidence(result.evidence));

  const comparison = compareWithHeaders(headers);
  if (!comparison.matches) {
    section.append(renderMismatch(comparison.differences));
  }

  target.append(section);
}

/**
 * 判定の根拠を描く。
 *
 * @param evidence 検証関数が返した根拠
 * @returns 根拠の要素
 */
function renderEvidence(
  evidence: Extract<VerificationResult, { kind: 'classified' }>['evidence'],
): HTMLElement {
  const block = document.createElement('dl');
  block.dataset['testid'] = 'evidence';

  const rows: [string, string][] = [
    ['算出したハッシュ', evidence.computedHash],
    ['チェーン上のハッシュ', evidence.anchoredHash],
    ['照会したチェーン ID', String(evidence.chainId)],
    ['照会したコントラクト', evidence.contractAddress],
  ];

  for (const [label, value] of rows) {
    const term = document.createElement('dt');
    term.textContent = label;

    const description = document.createElement('dd');
    description.textContent = value;

    block.append(term, description);
  }

  return block;
}

/**
 * 画面の照会先と API が示す値の食い違いを描く。
 *
 * 検証そのものは画面の設定値で行っている。食い違いは、利用者が状況を把握できる
 * ように示すだけとする。
 *
 * @param differences 食い違いの一覧
 * @returns 食い違いの要素
 */
function renderMismatch(
  differences: ReturnType<typeof compareWithHeaders>['differences'],
): HTMLElement {
  const block = document.createElement('div');
  block.dataset['testid'] = 'source-mismatch';

  const notice = document.createElement('p');
  notice.textContent =
    'API が示す刻印の照会先が、この画面が用いている照会先と異なります。' +
    '検証はこの画面の照会先で行っています。';
  block.append(notice);

  const list = document.createElement('ul');

  for (const difference of differences) {
    const item = document.createElement('li');
    item.textContent = `${difference.field}: この画面 ${difference.onScreen} / API ${difference.fromApi}`;
    list.append(item);
  }

  block.append(list);
  return block;
}
