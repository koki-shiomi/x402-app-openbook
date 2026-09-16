/**
 * 共有パッケージの ABI 定数が、コントラクトのビルド結果と一致することを確かめる。
 *
 * 共有パッケージはブラウザと Workers で動かすため Node の型を持たない。
 * ファイルの読み取りを伴うこの確認は、テストではなくスクリプトとして分ける。
 *
 * 使い方: contracts/ で `arc-forge build` を実行したうえで `pnpm check:abi`
 */
import { readFileSync } from 'node:fs';

import { ANCHOR_REGISTRY_ABI } from '../packages/shared/src/abi.ts';

const ARTIFACT = new URL('../contracts/out/AnchorRegistry.sol/AnchorRegistry.json', import.meta.url);

const { abi } = JSON.parse(readFileSync(ARTIFACT, 'utf8'));

const asText = (value) => JSON.stringify(value, null, 2);

if (asText(abi) !== asText(ANCHOR_REGISTRY_ABI)) {
  console.error('ABI がコントラクトのビルド結果と一致しません。packages/shared/src/abi.ts を更新してください。');
  process.exit(1);
}

console.log(`ABI は一致しています（${abi.length} 件の定義）。`);
