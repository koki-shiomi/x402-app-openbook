import type { DailyRecord, Entry, IncompleteItem } from '@openbook/shared';

/**
 * 1 日分の明細の描画。
 *
 * 各エントリには取得元・取得方式・提供元が値を改訂しうるかを添える。同じ金額でも
 * 実測値と宣言値では意味が異なり、取得方式を示さずに金額だけを並べると確からしさの
 * 違いが失われる。欠測は金額を持つエントリとして描かず、取得できなかった事実として
 * 別に示す。詳細は specs/public-dashboard/spec.md の「1 日分の明細の表示」を参照。
 */

/** 取得方式の表示名。 */
const ACQUISITION_LABELS: Record<string, string> = {
  measured: '実測',
  derived: '導出',
  estimated: '宣言',
};

/**
 * 明細を描く。
 *
 * @param target 描画先の要素
 * @param record 表示するレコード
 */
export function renderRecord(target: HTMLElement, record: DailyRecord): void {
  const section = document.createElement('section');
  section.dataset['testid'] = 'record';

  const heading = document.createElement('h2');
  heading.textContent = `${record.date}（版 ${record.revision}）`;
  section.append(heading);

  section.append(renderEntries('収益', record.revenues));
  section.append(renderEntries('費用', record.costs));

  if (record.incomplete.length > 0) {
    section.append(renderIncomplete(record.incomplete));
  }

  if (record.exchangeRates.length > 0) {
    section.append(renderExchangeRates(record.exchangeRates));
  }

  section.append(renderTotals(record));
  target.append(section);
}

/**
 * エントリの一覧を描く。
 *
 * @param title 見出し
 * @param entries 描くエントリ
 * @returns 一覧の要素
 */
function renderEntries(title: string, entries: readonly Entry[]): HTMLElement {
  const block = document.createElement('div');

  const heading = document.createElement('h3');
  heading.textContent = title;
  block.append(heading);

  if (entries.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = '該当なし';
    block.append(empty);
    return block;
  }

  const list = document.createElement('ul');

  for (const entry of entries) {
    const item = document.createElement('li');
    item.dataset['testid'] = 'entry';
    item.dataset['source'] = entry.source;
    item.dataset['acquisition'] = entry.acquisition;
    // 提供元が後から値を改訂しうるかは、値の確からしさに関わるため必ず持たせる。
    item.dataset['revisable'] = String(entry.revisable);

    const label = ACQUISITION_LABELS[entry.acquisition] ?? entry.acquisition;
    const revisable = entry.revisable ? '改訂されうる' : '確定';

    // 原通貨の金額と換算後の金額の双方を示す。JPY 建てなら換算は行われていない。
    const amount =
      entry.currency === 'JPY'
        ? `${entry.amount} JPY`
        : `${entry.amount} ${entry.currency}（${entry.amountJpy ?? '換算不能'} JPY）`;

    item.textContent = `${entry.source}: ${amount} — ${label}・${revisable}`;

    if (entry.basis?.description !== undefined) {
      const basis = document.createElement('span');
      basis.textContent = `（${entry.basis.description}）`;
      item.append(basis);
    }

    list.append(item);
  }

  block.append(list);
  return block;
}

/**
 * 欠測を描く。
 *
 * 金額を持つエントリとしては描かない。0 円として示すと、実態と異なる数値を
 * 公開することになる。
 *
 * @param items 欠測の記録
 * @returns 欠測の要素
 */
function renderIncomplete(items: readonly IncompleteItem[]): HTMLElement {
  const block = document.createElement('div');
  block.dataset['testid'] = 'incomplete';

  const heading = document.createElement('h3');
  heading.textContent = '取得できなかったもの';
  block.append(heading);

  const list = document.createElement('ul');

  for (const item of items) {
    const entry = document.createElement('li');
    entry.textContent = `${item.id}: ${item.reason}`;
    list.append(entry);
  }

  block.append(list);
  return block;
}

/**
 * 適用した為替レートを描く。
 *
 * @param rates レコードに記録されたレート
 * @returns レートの要素
 */
function renderExchangeRates(rates: DailyRecord['exchangeRates']): HTMLElement {
  const block = document.createElement('div');
  block.dataset['testid'] = 'exchange-rates';

  const heading = document.createElement('h3');
  heading.textContent = '適用した為替レート';
  block.append(heading);

  const list = document.createElement('ul');

  for (const rate of rates) {
    const item = document.createElement('li');
    item.textContent = `${rate.pair} ${rate.rate}（${rate.provider}、${rate.publishedOn} 公表）`;
    list.append(item);
  }

  block.append(list);
  return block;
}

/**
 * 集計値を描く。
 *
 * 欠測を含む場合はその旨を添える。含まない数値として読まれると、実態より
 * 確からしく見える。
 *
 * @param record 表示するレコード
 * @returns 集計値の要素
 */
function renderTotals(record: DailyRecord): HTMLElement {
  const block = document.createElement('div');
  block.dataset['testid'] = 'totals';

  const heading = document.createElement('h3');
  heading.textContent = '集計';
  block.append(heading);

  const lines = [
    `収益 ${record.totals.revenueJpy} JPY`,
    `費用 ${record.totals.costJpy} JPY`,
    `収支 ${record.totals.profitJpy} JPY`,
  ];

  if (record.totals.incomplete) {
    lines.push('※ 欠測を含むため、実際の値はこれと異なります');
  }

  for (const line of lines) {
    const paragraph = document.createElement('p');
    paragraph.textContent = line;
    block.append(paragraph);
  }

  return block;
}
