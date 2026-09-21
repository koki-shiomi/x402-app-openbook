## Why

コードレビューで見つかった残り 3 件を直す。いずれも現時点では表面化していないが、放置すると静かに誤った状態になる。

**実行記録の読み出しが 1000 件で頭打ちになる。** `readCollectionRuns` と `listPaymentReceipts` は `bucket.list()` を 1 回呼ぶだけで、`truncated` と `cursor` を辿っていない。R2 の 1 回の列挙は既定で 1000 件までしか返さない。収集の実行記録は 1 日 3 件増えるため、約 333 日で上限に達し、以降は**古い 1000 件だけが返って新しい記録が黙って落ちる**。同じ処理を `latestRevisionByPrefix` は正しく辿っており、実装が揃っていない。

**接続後の失敗で、誤った理由が表示され再試行できなくなる。** 画面のウォレット接続は、接続に成功した直後に接続ボタンを取り除いてから残高を照会する。照会が失敗すると、実際には接続できているのに「ウォレットへ接続できませんでした」と表示され、ボタンがすでにないため押し直せない。

**設定ファイルのコメントが実装とずれている。** `wrangler.jsonc` は担当範囲を「13〜26 日前 / 27〜40 日前」と説明しているが、実装は 13〜25 / 26〜40 である。`reduce-collection-requests` で配分を変えたときの直し漏れで、`check-crons.mjs` は定期実行の指定しか突き合わせないため検出できていない。

## What Changes

- R2 の列挙を最後まで辿る処理を共通化し、`readCollectionRuns` と `listPaymentReceipts` がそれを使うようにする
- 画面のウォレット接続で、接続後の失敗と接続そのものの失敗を区別して表示する。接続後に失敗した場合も操作をやり直せるようにする
- `wrangler.jsonc` のコメントを実装に合わせ、担当範囲の記述のずれを `pnpm check:crons` が検出できるようにする

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `daily-batch`: 実行記録の読み出しが、保存されているすべての記録を対象とすることを定める
- `public-dashboard`: 接続後の失敗で、誤った理由を示さず操作をやり直せることを定める

## Impact

- `apps/api/src/r2-listing.ts`: キーの列挙を公開し、他から使えるようにする
- `apps/api/src/runlog.ts`・`apps/api/src/payment/receipts.ts`: 列挙を共通の処理へ置き換える
- `apps/web/src/app.ts`: 接続ボタンを取り除く位置と、失敗時の表示を変える
- `apps/api/wrangler.jsonc`・`scripts/check-crons.mjs`: コメントの修正と、ずれの検出
- 公開している API の振る舞いは変わらない
