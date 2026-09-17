import type { AnchorReader, DailyRecord } from '@openbook/shared';

import { fetchAvailableRecords, type AvailableRecord } from './api.js';
import { readDeposit } from './deposit.js';
import { purchase } from './purchase.js';
import { renderRecord } from './record-view.js';
import { verify } from './verification.js';
import { renderVerification } from './verification-view.js';
import { connect, ensureChain, findProvider } from './wallet.js';
import type { EthereumProvider } from './preconditions.js';
import { ANCHOR_CHAIN_ID } from './config.js';

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
  /** ウォレットのプロバイダ。省略時はブラウザに注入されたものを探す。 */
  ethereum?: EthereumProvider;
  /** 決済の取次へ預け入れた残高を読む。省略時はチェーンへ照会する。 */
  readDeposit?: (asset: string, account: string) => Promise<bigint>;
  /** 刻印の照会。省略時は画面の設定値でチェーンへ照会する。 */
  reader?: AnchorReader;
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

  const result = document.createElement('section');
  result.dataset['testid'] = 'result';
  container.append(result);

  try {
    renderListing(listing, await fetchAvailableRecords(fetchImpl));
  } catch (error) {
    listing.append(
      paragraph(error instanceof Error ? error.message : '一覧を取得できませんでした'),
    );
    return;
  }

  listing.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLElement>(
      '[data-testid="buy"]',
    );
    const date = button?.dataset['date'];
    if (date === undefined) {
      return;
    }

    void buy(date, result, { fetchImpl, ...deps });
  });
}

/**
 * 1 日分を購入して明細と検証の結果を描く。
 *
 * 取得した内容は変数として持つだけで保存しない。画面を離れると失われる。
 *
 * @param date 対象日
 * @param target 描画先の要素
 * @param deps 依存
 */
async function buy(
  date: string,
  target: HTMLElement,
  deps: AppDeps & { fetchImpl: typeof fetch },
): Promise<void> {
  target.replaceChildren(paragraph(`${date} を購入しています…`));

  const ethereum = deps.ethereum ?? findProvider(globalThis as { ethereum?: unknown });
  if (ethereum === undefined) {
    target.replaceChildren(
      paragraph('ウォレットが見つかりません。ブラウザのウォレットを導入してください。'),
    );
    return;
  }

  try {
    // 接続とチェーンの確認は署名を伴わない。先に済ませて理由を示せるようにする。
    await connect(ethereum);
    await ensureChain(ethereum, ANCHOR_CHAIN_ID);
  } catch (error) {
    target.replaceChildren(
      paragraph(error instanceof Error ? error.message : 'ウォレットへ接続できませんでした'),
    );
    return;
  }

  const purchased = await purchase(date, {
    fetchImpl: deps.fetchImpl,
    ethereum,
    readDeposit: deps.readDeposit ?? readDeposit,
  });

  if (!purchased.ok) {
    target.replaceChildren(paragraph(purchased.message));
    if (purchased.details !== undefined) {
      target.append(renderDetails(purchased.details));
    }
    return;
  }

  target.replaceChildren();

  // 保存されたバイト列をそのまま解釈する。整形し直すとハッシュが変わる。
  const record = JSON.parse(new TextDecoder().decode(purchased.bytes)) as DailyRecord;
  renderRecord(target, record);

  const verified =
    deps.reader === undefined
      ? await verify(purchased.bytes)
      : await verify(purchased.bytes, deps.reader);

  renderVerification(target, verified, purchased.anchorHeaders);
}

/**
 * 事前条件を満たさない理由に添える値を描く。
 *
 * @param details 理由の詳細
 * @returns 詳細の要素
 */
function renderDetails(details: Record<string, unknown>): HTMLElement {
  const list = document.createElement('ul');
  list.dataset['testid'] = 'failure-details';

  for (const [key, value] of Object.entries(details)) {
    const item = document.createElement('li');
    item.textContent = `${key}: ${String(value)}`;
    list.append(item);
  }

  return list;
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
