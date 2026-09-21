## Context

現状は proposal.md の「Why」を参照。対象とする 2 エンドポイントの挙動（状態コード・ヘッダ・本文の形）は `docs/paid-api.md` と `openspec/specs/paid-record-api/spec.md`・`openspec/specs/x402-payment/spec.md` にすでに定められている。本チェンジはこれらを OpenAPI 形式へ書き起こし、配信する手段を用意するだけで、API 自体の振る舞いは変えない。

配信の基盤は `apps/web` の静的資産で、`apps/api/wrangler.jsonc` の `assets.directory` が指す `../web/dist` から配信される。Cloudflare Workers Static Assets は資産を先に照合し、一致しなければ Worker（Hono）へ回す。`apps/web` は Vite（既定設定、`vite.config.ts` なし）で `index.html` を単一のエントリとしてビルドしている。

## Goals / Non-Goals

**Goals:**

- `GET /openapi.json` と `GET /docs` を、既存の静的資産配信の仕組みに乗せて追加する
- 新しい依存を、画面の描画に使う 1 つ（Scalar、CDN 読み込み）に限る
- ドキュメントの内容が実際のエンドポイントの挙動から乖離しないよう、最小限の機械的な確認手段を用意する

**Non-Goals:**

- OpenAPI ドキュメントからのコード生成、または実装からのドキュメント自動生成
- JSON Schema による本文の厳密なバリデーション（ajv 等のライブラリは導入しない）
- x402 の発見レイヤーへの掲載

## Decisions

### 決定 1: OpenAPI ドキュメントは JSON で直接手書きする

提案時点では「`openapi.yaml` を手書き」としていたが、配信するパスは `GET /openapi.json` で確定している。YAML で書いて JSON へ変換する構成にすると、変換のための手段（ライブラリ追加、または手作業での同期）が要る。対象が 2 エンドポイントのみで分量が小さいため、変換の手間に見合わない。

`apps/web/public/openapi.json` として直接 JSON で書き、Vite の `public/` の既定の扱い（ビルド時に加工せず `dist/` 直下へそのまま複製する）にそのまま乗せる。

**代替案:**

- YAML で書いて手作業で JSON へ書き写す。同期漏れが起きる
- `js-yaml` 等を導入してビルド時に変換する。対象の小ささに対して依存が増える

### 決定 2: 静的資産として配置し、`apps/api` 側にルートを追加しない

`apps/web/public/openapi.json` と `apps/web/public/docs/index.html` を置く。Vite の `public/` はビルド時にそのまま `dist/` へ複製されるため、`vite.config.ts` の新規作成や既存ビルドの変更は不要である。`apps/api/wrangler.jsonc` の資産配信先はすでに `../web/dist` を指しているため、設定変更も不要である。

`/docs` は末尾スラッシュなしの要求になる。Cloudflare Workers Static Assets の `html_handling` は既定で `auto-trailing-slash` であり、設定を変更していないため、`docs/index.html` を置けば `/docs` への要求は `/docs/` へ転送されたうえで表示される（[Cloudflare Workers docs](https://developers.cloudflare.com/workers/static-assets/binding/)）。転送が 1 回挟まる点は許容する。

**代替案:**

- `apps/api` の Hono に `GET /openapi.json`・`GET /docs` を追加し、ファイルを import して返す。静的資産で足りる内容にコードパスを増やすことになる

### 決定 3: 画面は Scalar を CDN から読み込む

`docs/index.html` は `https://cdn.jsdelivr.net/npm/@scalar/api-reference@<バージョン>` を読み込み、`Scalar.createApiReference('#app', { url: '/openapi.json' })` で初期化する（[Scalar HTML/JS 統合](https://guides.scalar.com/scalar/scalar-api-references/integrations/htmljs)）。`url` は相対パスとし、同一オリジンの `/openapi.json` を指すため CORS の考慮は不要である。バージョンは実装時に確認できる最新の安定版を確認したうえで固定し、以後は明示的に上げない限り変わらないようにする。

これが本プロジェクトで最初の、配信物に含まれる外部 CDN への依存になる。ビルド時の依存（devDependencies）は増えない。

**代替案:**

- Swagger UI を自前でホストする。複数の静的ファイル（CSS・JS）を同梱する必要があり、Scalar の単一スクリプトタグより配置が煩雑
- Redoc。単一スクリプトで完結する点は Scalar と同等だが、Scalar より試せる操作（Try it out 相当）が弱い

### 決定 4: ドキュメントと実装の乖離を検知する最小限の確認

`apps/web/public/openapi.json` を読み、次を確かめるテストを `apps/web/test/` に追加する。ライブラリは追加せず、`JSON.parse` した結果を直接検査する。

- `paths` に `/v1/records` と `/v1/records/{date}` が含まれ、運営者向けの `/health`・`/admin/rerun` に相当するパスが含まれない
- `/v1/records/{date}` の `responses` に `docs/paid-api.md` が定める状態コード（200・400・402・404・409）がすべて含まれる

厳密な JSON Schema 検証ではなく構造の存在確認に留めるのは、状態コードやパスの過不足という明白な乖離を検知するためであり、本文のスキーマ内容の正しさまでは機械的に保証しない。内容の正しさはレビューに委ねる。

**代替案:**

- 検証しない。ドキュメントが実装から独立して手書きされる以上、乖離が無言のまま進む

## Risks / Trade-offs

- **手書きのため、エンドポイントの挙動を変えた際に `openapi.json` の更新を忘れうる** → 決定 4 の確認で、パスと状態コードの過不足は検知できる。応答の中身（スキーマの詳細）の正しさまでは保証しない
- **Scalar を外部 CDN から読み込むため、jsdelivr が不調だと `/docs` の描画が失われる** → `/openapi.json` 自体は自ホストのため、`/docs` が使えない間も生のドキュメントは取得できる。ツールに読み込ませる用途はここで代替できる
- **`/docs` は末尾スラッシュの転送が 1 回挟まる** → 挙動として許容する。転送先を含めて到達できることに変わりはない

## Migration Plan

デプロイのみで完結する。データの移行はない。`apps/web` をビルドし、`apps/api` をデプロイすれば新しい静的資産が配信される。反映後は `GET /openapi.json` と `GET /docs` の到達性、既存の `GET /v1/records`・`GET /v1/records/{date}`・`GET /health` の挙動が変わっていないことを本番で確認する。問題があれば直前の版へ戻せば復帰する。
