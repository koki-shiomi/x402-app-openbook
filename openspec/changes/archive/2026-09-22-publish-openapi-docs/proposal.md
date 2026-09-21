## Why

有料 API（`GET /v1/records`・`GET /v1/records/{date}`）を使うには、`docs/paid-api.md` の説明文を読んで自前で要求を組み立てる必要がある。機械可読な仕様がないため、クライアントを自動生成する手段も、ツールに読み込ませて疎通確認する手段もない。

利用者向けの API を、標準形式で読み・試せる状態にする。

## What Changes

- 有料 API のうち利用者向けの 2 エンドポイント（`GET /v1/records`・`GET /v1/records/{date}`）を記述した OpenAPI 3.1.0 ドキュメントを手書きで作成する
- `GET /openapi.json` でドキュメントそのものを、支払いなしで配信する
- `GET /docs` に、ドキュメントを読める画面（Scalar の API リファレンス、単一スクリプトタグで組み込み、ビルド手順を追加しない）を置く
- `docs/paid-api.md` から両方のパスへリンクする
- 運営者専用の `/admin/rerun` と稼働確認用の `/health` はドキュメントに含めない（既存仕様の「運営者向けエンドポイントの区別」による）
- 決済プロトコルの意味論（署名の組み立て方、EIP-712 のドメインなど）はドキュメントへ複製せず、`docs/paid-api.md` と `x402-payment` 仕様への参照に留める
- x402 の発見レイヤー（x402 Bazaar・open-x402-bazaar）への掲載は行わない。自ホストのみとする

## Capabilities

### New Capabilities

- `openapi-docs`: 有料 API の OpenAPI ドキュメントの内容と、その配信・閲覧手段を定める

### Modified Capabilities

なし。既存の `paid-record-api`・`x402-payment` の振る舞いは変えない。ドキュメントを追加するのみ。

## Impact

- `apps/web/`: `openapi.json`（配信物）と、`/docs` で返す画面を追加する。ビルド構成への影響は配信物を増やす程度に留める
- `apps/api/wrangler.jsonc`: 静的資産の配信先は変更しない（`apps/web` の配信物を追加するだけ）
- `docs/paid-api.md`: `GET /openapi.json` と `GET /docs` へのリンクを追記する
- 決定していない事項: OpenAPI ドキュメントの実体をどのディレクトリに置くか（`apps/web` 配下の静的配信物として持つか、`apps/api` 側で生成して返すか）は design.md で決める
