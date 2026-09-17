/**
 * 画面の静的な資産が API の経路と衝突しないことを確かめる。
 *
 * 資産は Worker より先に照合されるため、`v1` で始まる名前を置くと有料 API の
 * 経路を覆い隠してしまう。組み立ての結果を見て確認する。
 *
 * 使い方: `pnpm --filter @openbook/web build` のうえ `pnpm check:assets`
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = new URL('../apps/web/dist/', import.meta.url).pathname;

/** 生成物の名前を再帰的に集める。 */
function collect(directory, prefix = '') {
  const names = [];

  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const name = prefix === '' ? entry : `${prefix}/${entry}`;

    names.push(name);
    if (statSync(path).isDirectory()) {
      names.push(...collect(path, name));
    }
  }

  return names;
}

const names = collect(DIST);
const conflicting = names.filter((name) => name.startsWith('v1'));

if (conflicting.length > 0) {
  console.error('API の経路と衝突する資産があります:');
  for (const name of conflicting) {
    console.error(`  ${name}`);
  }
  process.exit(1);
}

console.log(`資産は API の経路と衝突していません（${names.length} 件）。`);
