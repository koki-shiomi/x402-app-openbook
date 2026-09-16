# Sizet OpenBook

個人開発アプリ「Sizet」の収益と費用を日次で公開するシステム。日次財務レコードのハッシュを Arc テストネットへ刻印し、第三者が改ざんの有無を検証できるようにする。

プロジェクトの目的・ロードマップ・チェンジ横断の確定方針・外部 API について確認済みの事実は [openspec/config.yaml](openspec/config.yaml) に集約している。本書はリポジトリの構成のみを扱う。

## ディレクトリ構成

```
apps/api/            Cloudflare Workers の API 本体と日次バッチ
  src/
    sources/         収集元ごとの実装
    anchor/          ハッシュ刻印の実装
  test/              テスト
packages/shared/     フロントエンドと共有するロジック
contracts/           刻印のコントラクト（Solidity）
docs/                第三者向けの手順書
scripts/             補助スクリプト
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

日次レコードの最新リビジョンのハッシュを Arc テストネットへ刻印する。収集を行った実行の後に 1 回呼ばれる。刻印の失敗を収集の失敗にしないため、例外を外へ投げず結果を実行記録に残す。

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

Workers・ブラウザ・Node で同じ実装が動くロジック。Node 固有の API は用いない。公開する要素は [index.ts](packages/shared/src/index.ts) からまとめてエクスポートする。テストは対象ファイルと同じ階層に `*.test.ts` として置く。

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
| [test-fixtures.ts](packages/shared/src/test-fixtures.ts) | テスト用のレコード生成 |

## contracts

刻印のコントラクト。`src/AnchorRegistry.sol` と `test/AnchorRegistry.t.sol` を置く。依存（`lib/`）はリポジトリに含めない。復元・ビルド・ABI 同期の手順は [contracts/README.md](contracts/README.md) を参照。

## docs

第三者向けの手順書。[verify-anchor.md](docs/verify-anchor.md) は公開データが改ざんされていないことを検証する手順を示す。

## scripts

ワークスペースのテストに収まらない補助スクリプト。[check-abi.mjs](scripts/check-abi.mjs) は共有パッケージの ABI 定数とコントラクトのビルド結果の一致を確かめる。

## openspec

仕様駆動開発の成果物。`specs/` が現行仕様、`changes/` が進行中のチェンジ、`changes/archive/` が完了したチェンジ。運用は [openspec/config.yaml](openspec/config.yaml) と `.claude/skills/` の各スキルに従う。

## 開発コマンド

リポジトリのルートで実行する。

```bash
pnpm typecheck    # 全ワークスペースの型検査
pnpm test         # 全ワークスペースのテスト
pnpm check:abi    # ABI 定数とコントラクトの一致確認
pnpm deploy       # apps/api のデプロイ
```

コントラクトのビルドとテストは `arc-forge` を用いる（[contracts/README.md](contracts/README.md)）。
