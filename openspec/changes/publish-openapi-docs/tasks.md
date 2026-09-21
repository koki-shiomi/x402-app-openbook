## 1. 仕様のテスト化（実装より先に行う）

- [x] 1.1 `openapi-docs` の「ドキュメントの対象範囲」の 2 つの Scenario をテストにする。`apps/web/public/openapi.json` を読み、`paths` に `/v1/records`・`/v1/records/{date}` が含まれ、運営者向けエンドポイントに相当するパスが含まれないことを確認する。この時点ではファイルがないため失敗することを確認する
- [x] 1.2 「決済プロトコルの意味論を複製しない」の Scenario のうち、402 応答のスキーマが記載されることをテストにする。`/v1/records/{date}` の `responses['402']` にスキーマが定義されていることを確認する
- [x] 1.3 「ドキュメントの配信」「閲覧用の画面」の Scenario をテストにする。`apps/web/public/openapi.json` と `apps/web/public/docs/index.html` がそれぞれ存在し、後者が `/openapi.json` を読み込む記述を含むことを確認する

## 2. OpenAPI ドキュメントの作成

- [x] 2.1 `apps/web/public/openapi.json` を作成する。`info`・`servers` を記載し、OpenAPI のバージョンを 3.1.0 とする。1.1 のテストが通ることを確認する
- [x] 2.2 `GET /v1/records` の定義を書く。`docs/paid-api.md` の応答例に基づき、200 応答のスキーマ（対象日とリビジョン番号の配列、金額を含まない）を記載する
- [x] 2.3 `GET /v1/records/{date}` の定義を書く。`{date}` のパスパラメータ、200・400・402・404・409 の各応答、`PAYMENT-SIGNATURE` 要求ヘッダ、刻印情報の応答ヘッダ（`X-Anchor-*`）を記載する。1.2 のテストが通ることを確認する
- [x] 2.4 402 応答に `PAYMENT-REQUIRED` ヘッダの中身（支払いの条件）のスキーマを記載する。実際の応答では条件はヘッダに入り本文は空であるため、ヘッダそのものの定義と、復号後の構造を表す `PaymentRequired` スキーマの双方を記載した（当初の「本文に記載する」という記述を実装に合わせて改めた）。決済の手順や署名の組み立て方は記載せず、`docs/paid-api.md` への参照のみを添える

## 3. 配信と画面

- [x] 3.1 `apps/web/public/docs/index.html` を作成する。Scalar を CDN から読み込み、`/openapi.json` を指定して初期化する。バージョンは npm で確認した最新の安定版を明示的に固定する。1.3 のテストが通ることを確認する
- [x] 3.2 `pnpm --filter @openbook/web build` を実行し、`dist/openapi.json` と `dist/docs/index.html` が生成されることを確認する

## 4. ドキュメントの相互参照

- [x] 4.1 `docs/paid-api.md` の冒頭に `GET /openapi.json` と `GET /docs` へのリンクを追記する

## 5. 反映と確認

- [x] 5.0 （本チェンジの範囲外の前提の修正）`apps/api` のテストが並列実行時に稀に待ち時間の上限を超える問題を解消する。既定の 5 秒に対し、刻印の署名などが負荷しだいで 10 秒近くかかることを実測しているため、`apps/api/vitest.config.ts` に上限を明示する。本チェンジ以前から存在する不安定さであり、`apps/api` には本チェンジの変更を加えていない
- [x] 5.1 `pnpm -r typecheck` と `pnpm -r test` がすべて成功することを確認する
- [ ] 5.2 デプロイし、`GET /openapi.json` が 200 でドキュメントを返すこと、`GET /docs` が画面を表示すること、既存の `GET /v1/records`・`GET /v1/records/{date}`・`GET /health` の挙動が変わっていないことを本番で確認する
- [ ] 5.3 本番の `/docs` を実機のブラウザで開き、`GET /v1/records` の一覧が Scalar の画面から実行できることを確認する
