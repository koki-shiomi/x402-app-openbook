## Why

①`setup-openbook-foundation` で日次財務レコードの形式・保存規約・バッチ実行基盤を整えたが、収集ソースが 0 件のため、生成されるレコードは常に空である。本チェンジで費用の取得元を実装し、公開できる実データを初めて記録する。

費用源は Claude API・Cloudflare・Resend・Supabase の 4 つで、2026-09 に各 API を実測して取得可否・粒度・制約を確認済みである（[openspec/config.yaml](../../config.yaml) の「外部依存について確認済みの事実」）。この結果、当初「課金額を返す API がない」と想定していた提供元でも、プランや課金対象の有無は取得できることが分かった。無料枠で運用している提供元の 0 円を、設定した月額からの推定ではなく **API で確認したプランを根拠として記録できる**状態になっている。

## What Changes

- **Claude API の費用を日次で実測取得する**。`cost_report` を日次バケットで呼び出し、モデル別・入出力トークン別の内訳とともに記録する。**`amount` の単位はセントであり、USD として扱うと 100 倍に誤る**ため、変換を明示的に行う
- **sizet 専用ワークスペースの費用のみを対象とする**。`cost_report` は組織全体を返しキー単位では絞れないため、`workspace_id` で分解して sizet 分を取り出す
- **Cloudflare の費用が 0 円であることを 3 つの API で裏付ける**。`subscriptions` の価格がすべて 0（Workers Paid などを未契約）、`billable-usage` の請求額の合計が 0（従量課金なし）、`billing/history` に対象期間の請求なし、をそれぞれ確認して算出根拠に記録する
- **Resend の日別送信数を取得し、無料プランの宣言を根拠として 0 円を記録する**。課金額を返す API がなく、プラン判定に使える `x-resend-daily-quota` ヘッダは送信時のレスポンスにしか付かないため、プランは設定値として宣言する
- **Supabase のプランと課金アドオンを取得して 0 円を裏付ける**。`organizations/{slug}` の `plan` と `projects/{ref}/billing/addons` の `selected_addons` を算出根拠に記録する
- **取得元ごとの遡及可能期間を宣言する**。Resend は約 30 日まで遡れる。Supabase のプランと Cloudflare のサブスクリプションは現在の状態しか返さないため、前日までとする。宣言は月次クローズ時の再収集可否の判定に用いる
- **認証情報の権限の範囲を明示する**。Supabase は read-only PAT、Cloudflare は Billing Read で足りることを実測済み。Claude の Admin キーと Resend の API キーは読み取り専用の権限が提供されておらず、権限を絞れない。Cloudflare は運用上の判断でデプロイ用のトークンを兼用する。これらの扱いを設計で明示する

対象は費用のみで、収益の取得は③`collect-daily-revenue` で行う。過去分の遡及取り込みは行わず、本チェンジの稼働開始日以降を対象とする。

## Capabilities

### New Capabilities

- `cost-collection`: 4 つの提供元から日次の費用を取得し、取得方式と算出根拠つきの費用エントリへ変換する規則
- `provider-credentials`: 各提供元の認証情報に求める権限と、権限内でも呼び出してはならないエンドポイントの規定

### Modified Capabilities

- `daily-batch`: 収集ソースが遡及可能期間を宣言する方法を、実際の取得元をもとに具体化する。月次クローズで稼働開始前の日を取り込まないよう、再収集の対象を既存のレコードがある日に限る

## Impact

- **コード**: `apps/api/src/sources/` に 4 つの収集ソースを追加し、`apps/api/src/index.ts` の `SOURCES` へ登録する。①で定めた `CollectionSource` インタフェースを満たす形で追加するため、バッチ・保存・集計の既存コードは変更しない
- **認証情報**: Claude Admin キー・Cloudflare のトークン（デプロイ用と兼用）・Resend の `full_access` キー・Supabase read-only PAT の 4 つを Worker のシークレットとして設定する
- **事前作業**: Claude コンソールで sizet 専用ワークスペースを作成し、既存の `sizet` キーを移動する必要がある。これを行わないと Claude Code など他用途の利用が費用に混入する
- **公開データ**: 本チェンジ以降、日次レコードの `costs` に実データが入る。Cloudflare のドメイン登録費（2026-05-07 の $15.62）はアプリの運用費ではないため対象外とする。この結果、公開する費用合計は Cloudflare の請求実績とは一致しない
- **後続チェンジへの制約**: ④のハッシュ刻印の対象となるレコードに実データが入るため、本チェンジ以降に生成された月がクローズ・刻印の対象になる
