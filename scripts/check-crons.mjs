/**
 * 設定ファイルの定期実行が、実装が定める担当と一致することを確かめる。
 *
 * 対応が崩れると、担当のない指定で起動して何も収集されない日が生じる。
 * ファイルの読み取りを伴うため、Workers 上で動くテストではなくスクリプトとして分ける。
 *
 * 使い方: `pnpm check:crons`
 */
import { readFileSync } from 'node:fs';

import { ANCHOR_TRIGGER, COLLECTION_TRIGGERS } from '../apps/api/src/triggers.ts';

const CONFIG = new URL('../apps/api/wrangler.jsonc', import.meta.url);

/** JSONC からコメントを取り除いて解析する。 */
function parseJsonc(text) {
  const withoutComments = text
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  return JSON.parse(withoutComments);
}

const { triggers } = parseJsonc(readFileSync(CONFIG, 'utf8'));
const configured = triggers?.crons ?? [];
const expected = [...COLLECTION_TRIGGERS.map((trigger) => trigger.cron), ANCHOR_TRIGGER];

const sorted = (list) => [...list].sort();

if (JSON.stringify(sorted(configured)) !== JSON.stringify(sorted(expected))) {
  console.error('定期実行の指定が実装と一致しません。');
  console.error(`  設定ファイル: ${JSON.stringify(configured)}`);
  console.error(`  実装:         ${JSON.stringify(expected)}`);
  process.exit(1);
}

console.log(`定期実行は一致しています（収集 ${COLLECTION_TRIGGERS.length} 本 + 刻印 1 本）。`);
