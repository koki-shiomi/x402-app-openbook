## 1. 仕様のテスト化（実装より先に行う）

- [x] 1.1 `daily-batch` の「1 度の列挙の上限を超える数の記録」の Scenario をテストにする。1000 件を超える実行記録を置き、すべて返ることを確認する。この時点では失敗することを確認する
- [x] 1.2 `public-dashboard` の「接続の後の照会が失敗する」「失敗した後のやり直し」の 2 つの Scenario をテストにする。残高の照会が失敗する状況で、接続の失敗を示さないことと、操作が残ることを確認する。この時点では失敗することを確認する

## 2. 列挙の辿り方の共通化

- [x] 2.1 `r2-listing.ts` の `listKeys` を公開する
- [x] 2.2 `readCollectionRuns` と `listPaymentReceipts` を `listKeys` を使う形に置き換える。1.1 のテストが通ることを確認する
- [x] 2.3 `bucket.list()` を直接呼ぶ箇所が残っていないことを確認する。レビューが挙げた 2 箇所のほかに、同じ欠陥が `readAnchorRuns`・`latestKey`・`listRecords` の 3 箇所にもあったため、あわせて共通の処理へ置き換えた

## 3. 接続後の失敗の扱い

- [x] 3.1 接続そのものの失敗と、接続後の失敗を分けて扱うようにする。接続の操作を取り除くのは後続の処理が終わってからにする。1.2 のテストが通ることを確認する

## 4. 担当範囲の記述のずれの検出

- [x] 4.1 `scripts/check-crons.mjs` が、`wrangler.jsonc` のコメントに書かれた担当範囲と `COLLECTION_TRIGGERS` の `slice` を突き合わせるようにする。現状のずれを検出して失敗することを確認する
- [x] 4.2 `wrangler.jsonc` のコメントを実装に合わせて修正する。`pnpm check:crons` が成功することを確認する

## 5. 反映と確認

- [x] 5.1 `pnpm -r typecheck`・`pnpm -r test`・`pnpm check:crons`・`pnpm check:assets` がすべて成功することを確認する
- [ ] 5.2 デプロイし、`GET /v1/records`・`GET /v1/records/{date}`・`GET /health`・画面の挙動が変わっていないことを本番で確認する
