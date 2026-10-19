# x402-app-openbook

アプリの収益と費用を日次で記録し、x402 決済を通じて提供するシステム。日次財務レコードのハッシュを Arc メインネットへ刻印し、第三者が改ざんの有無を検証できるようにする。

プロジェクトの目的・ロードマップ・チェンジ横断の確定方針・外部 API について確認済みの事実は [openspec/config.yaml](openspec/config.yaml) に集約している。仕様は `openspec/specs/` と進行中の変更に集約し、本書はリポジトリの構成・使い方・開発手順を扱う。

## ディレクトリ構成

```
apps/api/            Cloudflare Workers の API 本体と日次バッチ
  src/
    sources/         収集元ごとの実装
    anchor/          ハッシュ刻印の実装
  test/              テスト
packages/shared/     フロントエンドと共有するロジック
contracts/           刻印のコントラクト（Solidity）
openspec/            仕様（現行・進行中・完了）
```

`apps/*` と `packages/*` を pnpm ワークスペースとして扱う。`contracts/` はワークスペースに含めず Arc Foundry で扱う。

## apps/api

Cloudflare Workers 上で動く API と日次バッチ。

### src/ 直下

| ファイル | 役割 |
| --- | --- |
| [index.ts](apps/api/src/index.ts) | Worker の入口。Hono アプリ（`GET /health`、`POST /admin/rerun`）と Cron ハンドラを定義し、収集ソースと実行時の依存を組み立てる |
| [batch.ts](apps/api/src/batch.ts) | 日次バッチの実行。収集ソースの実行と記録、訂正リビジョンを追加するかの判定 |
| [schedule.ts](apps/api/src/schedule.ts) | 定期実行の対象期間の算出。前日を対象とし、あわせて一定日数以内の既存レコードを再収集する |
| [storage.ts](apps/api/src/storage.ts) | R2 上の日次レコードと生応答の保存規約。保存されたバイト列がそのまま刻印対象かつ公開物になるため、取得時に再直列化しない |
| [runlog.ts](apps/api/src/runlog.ts) | 実行記録の型と保存。訂正を見送った判断もここに残す |
| [auth.ts](apps/api/src/auth.ts) | 手動再実行エンドポイントの認証。応答時間から一致文字数を推測されないよう定数時間で比較する |

### src/sources/

収集元ごとの実装。`index.ts` がすべての提供元を収集ソースとして登録する。認証情報が未設定の提供元も登録し、収集時に理由を伴って失敗させる。登録から外すと「無料枠内で 0 円」と「そもそも取得していない」が公開データ上で区別できなくなるためである。

| ファイル | 役割 |
| --- | --- |
| [index.ts](apps/api/src/sources/index.ts) | 収集ソースの組み立てと登録 |
| [config.ts](apps/api/src/sources/config.ts) | 設定値と認証情報の読み取り。欠けている提供元は収集を試みず欠測にする |
| [claude.ts](apps/api/src/sources/claude.ts) | Claude API の費用収集。唯一の変動費 |
| [cloudflare.ts](apps/api/src/sources/cloudflare.ts) | Cloudflare の費用収集 |
| [resend.ts](apps/api/src/sources/resend.ts) | Resend の費用収集。課金額を返す API がないためプランを宣言し、日別送信数を併記する |
| [supabase.ts](apps/api/src/sources/supabase.ts) | Supabase の費用収集。プランと課金アドオンの有無で費用が発生していないことを確認する |
| [admob.ts](apps/api/src/sources/admob.ts) | AdMob の収益収集。取得できるのは推定値のみ |

### src/anchor/

日次レコードの最新リビジョンのハッシュを Arc メインネットへ刻印する。収集を行った実行の後に 1 回呼ばれる。刻印の失敗を収集の失敗にしないため、例外を外へ投げず結果を実行記録に残す。

| ファイル | 役割 |
| --- | --- |
| [index.ts](apps/api/src/anchor/index.ts) | 刻印の実行。他のファイルを順に呼び、どの経路でも実行記録を残す。唯一の公開入口 |
| [config.ts](apps/api/src/anchor/config.ts) | 設定と署名鍵の読み取り。欠けている場合は刻印せず、未設定の項目名を実行記録に残す |
| [targets.ts](apps/api/src/anchor/targets.ts) | 刻印の対象の算出。保存済みレコードと刻印結果を突き合わせ、最新リビジョンが未刻印の日を対象とする。再収集の対象期間には依存しない |
| [chain.ts](apps/api/src/anchor/chain.ts) | チェーンへの接続。状態の読み取りと刻印トランザクションの送信 |
| [reconcile.ts](apps/api/src/anchor/reconcile.ts) | 送信前の突き合わせ。送信・記録のみ・食い違いに分ける。コントラクトは既存以下のリビジョンを 1 件でも含む送信を全件差し戻すため、事前に除く必要がある |
| [store.ts](apps/api/src/anchor/store.ts) | 刻印の結果と実行記録の保存・読み出し |

### test/

`src/` と同じ構成で対応するテストを置く（`test/sources/`、`test/anchor/`）。複数のモジュールにまたがるものは `integration.test.ts` などの名前で直下に置く。

## packages/shared

Workers・ブラウザ・Node で同じ実装が動くロジック。Node 固有の API は用いない。公開する要素は [index.ts](packages/shared/src/index.ts) からまとめてエクスポートする。テストとフィクスチャは `test/` に置き、`src/` の実装を検証する。文書・運用記録・ビルド生成物はテストの入力にしない。

| ファイル | 役割 |
| --- | --- |
| [record.ts](packages/shared/src/record.ts) | 日次財務レコードの型定義、レコード形式のバージョン、通貨ごとの小数桁数 |
| [create.ts](packages/shared/src/create.ts) | レコードの生成 |
| [validate.ts](packages/shared/src/validate.ts) | レコードの検証 |
| [totals.ts](packages/shared/src/totals.ts) | 集計値の算出 |
| [canonical.ts](packages/shared/src/canonical.ts) | 正準 JSON 表現。RFC 8785 に従い、配列の並び順を別途規定する |
| [decimal.ts](packages/shared/src/decimal.ts) | 10 進固定小数点演算。金額は文字列で保持し BigInt で計算する |
| [exchange.ts](packages/shared/src/exchange.ts) | Frankfurter による USD/JPY レートの取得と換算 |
| [policy.ts](packages/shared/src/policy.ts) | 再収集の日数と訂正リビジョンの閾値。変更はデプロイで反映する |
| [hash.ts](packages/shared/src/hash.ts) | SHA-256 の算出。レコードのバイト列そのものを対象とする |
| [abi.ts](packages/shared/src/abi.ts) | `AnchorRegistry` の ABI。コントラクトの変更時に同時に更新する |
| [reader.ts](packages/shared/src/reader.ts) | 刻印のコントラクトへの照会。view 関数のみを用い、イベントの走査を行わない |
| [verify.ts](packages/shared/src/verify.ts) | 公開されたバイト列とチェーン上の刻印の照合。運営者の記録を判定根拠にしない |

## contracts

刻印のコントラクト。`src/AnchorRegistry.sol` と `test/AnchorRegistry.t.sol` を置く。依存（`lib/`）はリポジトリに含めない。復元・ビルド・ABI 同期の手順は [contracts/README.md](contracts/README.md) を参照。

## openspec

仕様駆動開発の成果物。`specs/` が現行仕様、`changes/` が進行中のチェンジ、`changes/archive/` が完了したチェンジ。運用は [openspec/config.yaml](openspec/config.yaml) と `.claude/skills/` の各スキルに従う。

## 開発コマンド

リポジトリのルートで実行する。

```bash
pnpm typecheck    # 全ワークスペースの型検査
pnpm test         # 全ワークスペースのテスト
pnpm run deploy   # Web資産のビルドと apps/api のデプロイ
```

テストとフィクスチャは各パッケージの `test/` に置く。APIのテスト環境は `apps/api/test/support/runtime.ts` で定義し、本番のWrangler設定・文書・Webのビルド生成物を読み込まない。

コントラクトのビルドとテストは `arc-forge` を用いる（[contracts/README.md](contracts/README.md)）。ABIはコントラクト変更時にビルド結果と手動で照合する。配備前には `apps/api/wrangler.jsonc` のCronが `apps/api/src/triggers.ts` と一致すること、およびWeb生成物に `v1` で始まる資産がないことを確認する。


## APIの使い方

本番の基底URLは `https://sizet-openbook-api.c7uv-tk16-s.workers.dev`。要求・応答の仕様は [paid-record-api](openspec/specs/paid-record-api/spec.md)、決済は [x402-payment](openspec/specs/x402-payment/spec.md) を参照する。機械可読な仕様は `/openapi.json`、閲覧画面は `/docs`、購入画面は `/` にある。

一覧は支払い不要で取得できる。

```bash
curl -s https://sizet-openbook-api.c7uv-tk16-s.workers.dev/v1/records
```

日次レコードは `GET /v1/records/{date}` から購入する。日付は UTC の暦日で指定し、価格は1日分0.10 USDC。購入・預入れには実際の USDC を使う。画面からウォレットを接続し、Gateway Walletへの預入れ後に対象日を購入できる。

## 支払いの手順

x402 V2 の標準的な流れに従う。決済の検証と実行は Circle の hosted facilitator が行う。

1. 支払いなしで `GET /v1/records/{date}` を要求する
2. 402 と `PAYMENT-REQUIRED` ヘッダ（Base64 の支払い条件）が返る
3. 条件に沿って支払いを署名し、`PAYMENT-SIGNATURE` ヘッダを付けて同じ要求を再送する
4. 決済が成立すると 200 でレコードが返り、`PAYMENT-RESPONSE` ヘッダに成立の結果が入る

### 事前に必要なこと

支払いに用いる USDC は、Circle の Gateway Wallet（`0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE`）へ預け入れておく必要がある。ウォレットに USDC を持っているだけでは決済が `insufficient_balance` となる。

```
approve(0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE, 預ける額)  # USDC のコントラクトへ
deposit(0x3600000000000000000000000000000000000000, 預ける額)  # Gateway Wallet へ
```

支払い元と受取先が同一のアドレスである支払いは受け付けられない（`self_transfer`）。

### 署名

`TransferWithAuthorization` の EIP-712 署名を作る。**ドメインは資産のものではなく、支払いの条件の `extra` が示すものを用いる。**

| ドメインの項目 | 取得元 |
| --- | --- |
| `name` | 支払いの条件の `extra.name`（`GatewayWalletBatched`） |
| `version` | 支払いの条件の `extra.version` |
| `chainId` | 支払いの条件の `network` の `eip155:` 以降 |
| `verifyingContract` | 支払いの条件の `extra.verifyingContract` |

署名の有効期限（`validBefore`）は、条件の `maxTimeoutSeconds` を現在時刻に足した値とする。`extra.minValiditySeconds` を下回ると `authorization_validity_too_short` として拒まれる。

```javascript
const required = JSON.parse(atob(response.headers.get('PAYMENT-REQUIRED')));
const accepted = required.accepts[0];

const authorization = {
  from: account.address,
  to: accepted.payTo,
  value: accepted.amount,
  validAfter: '0',
  validBefore: String(Math.floor(Date.now() / 1000) + accepted.maxTimeoutSeconds),
  nonce: ランダムな 32 バイト,
};

const signature = await account.signTypedData({
  domain: {
    name: accepted.extra.name,
    version: accepted.extra.version,
    chainId: Number(accepted.network.split(':')[1]),
    verifyingContract: accepted.extra.verifyingContract,
  },
  types: {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ],
  },
  primaryType: 'TransferWithAuthorization',
  message: { ...authorization を数値へ直したもの },
});

const header = btoa(JSON.stringify({
  x402Version: 2,
  payload: { authorization, signature },
  resource: required.resource,
  accepted,
}));
```

**既存のクライアント実装について:** `@x402/evm` 2.26.0 の `exact` スキームのクライアントは、署名の `verifyingContract` に資産のアドレスを固定で用いる。条件が示す `extra.verifyingContract` を用いないため、この実装のままでは `invalid_signature` となる。上記のように自前で署名する必要がある。

## 取得したレコードの検証

### 1. レコードのバイト列を入手する

有料 API から取得したレスポンス本文を、そのままファイルへ保存する。整形（インデントの追加、キーの並べ替え、末尾改行の追加）を行うとハッシュが変わるため、受け取ったバイト列を一切変更しない。

```bash
curl -s <レコードの URL> -o record.json
```

### 2. ハッシュを算出する

```bash
sha256sum record.json
```

出力は `0x` を伴わない 64 桁の 16 進数である。エクスプローラは `0x` つきで表示するため、比較するときは接頭辞の有無を揃える。

### 3. 対象日とリビジョンを読み取る

レコードの `date` と `revision` を見る。対象日は `YYYY-MM-DD` 形式だが、コントラクトは `YYYYMMDD` 形式の整数で保持している。

| レコードの `date` | コントラクトへ入力する値 |
| --- | --- |
| `2026-09-13` | `20260913` |

### 4. コントラクトへ照会する

ソース公開検証が完了している場合は、エクスプローラの **Contract → Read Contract** から次の 2 つを呼べる。未完了の場合は下記の RPC コマンドを使う。トランザクションの送信は不要で、ウォレットの接続も要らない。

| 関数 | 入力 | 返る値 |
| --- | --- | --- |
| `hashOf` | 対象日（`20260913`）、リビジョン | そのリビジョンに刻印されたハッシュ。未刻印ならすべて 0 |
| `latestRevisionOf` | 対象日（`20260913`） | その対象日に刻印された最大のリビジョン番号。刻印がなければ 0 |

以下の日付とリビジョンは入力形式の例であり、実際に取得したレコードの値へ置き換える。コマンドで照会する場合は次のとおり。

```bash
cast call 0xC039722204Dde6DF3dFb48a9a3068163d30b997a \
  "hashOf(uint32,uint32)(bytes32)" 20260913 2 --rpc-url https://rpc.mainnet.arc.io
cast call 0xC039722204Dde6DF3dFb48a9a3068163d30b997a \
  "latestRevisionOf(uint32)(uint32)" 20260913 --rpc-url https://rpc.mainnet.arc.io
```

### 5. 結果を判定する

手順2のSHA-256と `hashOf` を照合し、レコードのリビジョンと `latestRevisionOf` を比較する。判定分類と注意点は [anchor-verification](openspec/specs/anchor-verification/spec.md) を参照する。
