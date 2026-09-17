import { fetchAvailableRecords, type AvailableRecord } from './api.js';

/**
 * 画面の組み立て。
 *
 * 状態は「一覧」「購入中」「明細」の 3 つに限る。UI のフレームワークは用いず、
 * 要素を直接組み立てる。詳細は design.md の決定 2 を参照。
 */

/** 画面の依存。テストから差し替える。 */
export interface AppDeps {
  /** 取得に用いる関数。省略時はブラウザの `fetch`。 */
  fetchImpl?: typeof fetch;
}

/**
 * 画面を組み立てて描く。
 *
 * @param container 描画先の要素
 * @param deps 依存
 */
export async function mount(container: HTMLElement, deps: AppDeps = {}): Promise<void> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);

  container.replaceChildren(renderIntro(), renderNotice());

  const listing = document.createElement('section');
  listing.dataset['testid'] = 'listing';
  container.append(listing);

  try {
    renderListing(listing, await fetchAvailableRecords(fetchImpl));
  } catch (error) {
    listing.append(
      paragraph(error instanceof Error ? error.message : '一覧を取得できませんでした'),
    );
  }
}

/**
 * この画面の位置づけを示す。
 *
 * 主たる取得経路は API そのものであり、この画面はその内容を確かめるための
 * ものであることを、利用者が最初に読む位置に置く。
 *
 * @returns 説明の要素
 */
function renderIntro(): HTMLElement {
  const section = document.createElement('section');

  const heading = document.createElement('h1');
  heading.textContent = 'Sizet OpenBook';
  section.append(heading);

  section.append(
    paragraph(
      '個人開発アプリ「Sizet」の日次の収支を公開しています。' +
        'この画面は、有料 API で何が取得できるかを実際に 1 日分を購入して' +
        '確かめるためのものです。データの主たる取得経路は API そのものです。',
    ),
  );

  return section;
}

/**
 * 購入の前に示す断り。
 *
 * 保存しないため、同じ日を再び表示するには再び支払う必要がある。購入の操作より
 * 前に置き、意図しない二重の支払いを防ぐ。
 *
 * @returns 断りの要素
 */
function renderNotice(): HTMLElement {
  const notice = document.createElement('aside');
  notice.dataset['testid'] = 'ephemeral-notice';

  notice.append(
    paragraph(
      '購入した内容はこの画面の中だけに置き、保存しません。' +
        '画面を離れると失われ、同じ日を再び表示するには再び支払いが必要です。',
    ),
  );

  return notice;
}

/**
 * 取得可能な対象日の一覧を描く。
 *
 * 対象日とリビジョン番号のみを示し、金額は含めない。金額を支払いなしで示すと、
 * 有料 API が金額を有料としている前提が画面側から崩れる。
 *
 * @param target 描画先の要素
 * @param records 取得可能な対象日
 */
function renderListing(target: HTMLElement, records: readonly AvailableRecord[]): void {
  const heading = document.createElement('h2');
  heading.textContent = '取得できる日';
  target.append(heading);

  if (records.length === 0) {
    target.append(paragraph('取得できる日がありません。'));
    return;
  }

  const list = document.createElement('ul');

  for (const record of records) {
    const item = document.createElement('li');

    const date = document.createElement('span');
    date.dataset['testid'] = 'record-date';
    date.textContent = record.date;

    const revision = document.createElement('span');
    revision.dataset['testid'] = 'record-revision';
    revision.textContent = String(record.revision);

    const buy = document.createElement('button');
    buy.type = 'button';
    buy.dataset['testid'] = 'buy';
    buy.dataset['date'] = record.date;
    buy.textContent = 'この日を購入する';

    item.append(date, document.createTextNode(' 版 '), revision, document.createTextNode(' '), buy);
    list.append(item);
  }

  target.append(list);
}

/**
 * 段落の要素を作る。
 *
 * @param text 本文
 * @returns 段落の要素
 */
function paragraph(text: string): HTMLParagraphElement {
  const element = document.createElement('p');
  element.textContent = text;
  return element;
}
