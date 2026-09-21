## Why

本システムは Arc Testnet 上で動いている。刻印も決済もテストネットの資産で行われるため、公開している「検証できる収支」は実質的に練習であり、支払いも実際の価値を伴わない。

Arc のメインネットが 2026-09-16 に稼働した。Circle の本番 facilitator（`https://gateway-api.circle.com/v1/x402`）は `eip155:5042` に対応しており、テストネットと同じ `exact` スキーム・同じ `GatewayWalletBatched` のドメインで決済できることを確認した。移行の障害になる技術的な差は見当たらない。

実際の USDC で決済が成立し、実際のチェーンに刻印された収支を公開する状態にする。

## What Changes

- 刻印先を Arc Testnet（`eip155:5042002`）から Arc メインネット（`eip155:5042`）へ移す。刻印のコントラクトはメインネットへ新たに配備する
- 決済の取次を Circle のテストネット facilitator から本番 facilitator へ移す。Gateway Wallet のアドレスが `0x0077777d7eba4688bdef3e311b846f25870a19b9` から `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` へ変わる
- 画面・API・文書が参照するチェーン ID・RPC・コントラクト・エクスプローラを、メインネットのものへ差し替える
- 移行前の対象日（テストネットで刻印した 13 日分）を**公開の対象から外す**。レコードと刻印は保存したまま、API の一覧にも取得にも現れないようにする
- **BREAKING**: 移行前の対象日は取得できなくなる。移行後に公開されるのは、メインネットで刻印した日だけになる
- 価格は 0.10 USDC のまま変えない。ただし**実際の USDC** になる

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `hash-anchoring`: 刻印先のチェーンが設定で決まること、および設定したチェーン以外で刻印された日を公開の対象としないことを定める
- `paid-record-api`: 一覧と取得の対象を、現在の刻印先のチェーンで検証できる日に限ることを定める
- `provider-credentials`: 刻印用の鍵が実際の価値を持つ資産を扱うことを明示する

## Impact

- `apps/api/src/anchor/chain.ts`: `arcTestnet` とチェーン ID の固定値
- `apps/api/src/payment/middleware.ts`: `PAYMENT_NETWORK`
- `apps/web/src/config.ts`・`wallet.ts`・`deposit.ts`: チェーン ID・RPC・Gateway Wallet・エクスプローラ
- `packages/shared/src/reader.ts`: 検証時の照会先
- `apps/web/public/openapi.json`・`docs/paid-api.md`・`docs/verify-anchor.md`: 公開する値
- シークレット `ARC_RPC_URL`・`ARC_ANCHOR_CONTRACT`・`X402_FACILITATOR_URL` の差し替え
- **実費が発生する**。刻印用 EOA へ実際の USDC を入れる必要がある。実測した見積もりは、刻印 1 件あたり約 0.0018 USDC、1 日 1 回の運用で年間約 0.65 USDC。コントラクトの配備は 1 回限りで、これも 1 USDC に満たない
- 移行前のレコードと刻印は削除せず、公開の対象から外れるだけとする
