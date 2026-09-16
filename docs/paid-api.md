# 有料 API

日次財務レコードを x402 による USDC 決済つきで公開する API である。取得したバイト列は、Arc テストネット上に刻印されたハッシュと照合して検証できる。検証の手順は [verify-anchor.md](verify-anchor.md) を参照。

## 基本情報

| 項目 | 値 |
| --- | --- |
| 基底 URL | `https://sizet-openbook-api.c7uv-tk16-s.workers.dev` |
| 決済のプロトコル | x402 V2 |
| 決済のネットワーク | Arc Testnet（`eip155:5042002`） |
| 決済の資産 | USDC（`0x3600000000000000000000000000000000000000`、6 桁） |
| 価格 | 日次レコード 1 日分あたり 0.10 USDC |

## `GET /v1/records`

取得可能な対象日の一覧を返す。支払いは不要である。

対象日とリビジョン番号のみを返し、金額は含めない。一覧に現れるのは、レコードが存在し、かつ最新リビジョンが刻印済みの日だけである。

**応答**

```json
{
  "records": [
    { "date": "2026-09-15", "revision": 1 },
    { "date": "2026-09-14", "revision": 1 }
  ]
}
```

対象日の降順で並ぶ。

## `GET /v1/records/{date}`

指定した対象日の日次財務レコードを返す。支払いが必要である。

`{date}` は UTC の暦日を `YYYY-MM-DD` 形式で指定する。返るのは常に**最新リビジョン**であり、過去のリビジョンを指定する手段はない。

**本文**

保存されているバイト列がそのまま返る。正準 JSON（RFC 8785 + 配列の並び順規則）である。この API が返したバイト列を 1 バイトも変えずに SHA-256 を取ると、チェーン上に刻印されたハッシュと一致する。整形・キーの並べ替え・再直列化を行うと一致しなくなる。

**刻印情報の応答ヘッダ**

| ヘッダ | 内容 |
| --- | --- |
| `X-Anchor-Revision` | 刻印されたリビジョン番号 |
| `X-Anchor-Hash` | 刻印された SHA-256（`0x` つき） |
| `X-Anchor-Chain-Id` | チェーン ID（`5042002`） |
| `X-Anchor-Contract` | 刻印のコントラクトのアドレス |
| `X-Anchor-Transaction` | 刻印のトランザクションのハッシュ |
| `X-Anchor-Block` | 刻印が含まれるブロック番号 |

`X-Anchor-Transaction` と `X-Anchor-Block` は、刻印の記録を後から補った場合に省かれることがある。その場合もチェーン上の照会による検証は成立する。

**状態コード**

| コード | 意味 |
| --- | --- |
| 200 | 決済が成立し、レコードを返した |
| 400 | 対象日が `YYYY-MM-DD` 形式でない、または実在しない暦日である |
| 402 | 支払いが必要である。応答に支払いの条件が含まれる |
| 404 | 指定した対象日のレコードが存在しない |
| 409 | レコードは存在するが、まだ刻印されていない（刻印待ち）。時間をおいて再度要求できる |
| 503 | 決済の設定が未完了、または決済の取次に接続できないため、一時的に利用できない |

400・404・409 は**支払いを求める前**に返る。取得できないものに支払うことはない。

409 が返るのは、収集からハッシュの刻印までの短い間と、刻印が失敗してから次の実行までの間である。この API は「返すすべての情報が検証可能であること」を鮮度より優先するため、未刻印のレコードは返さない。

## 支払いの手順

x402 V2 の標準的な流れに従う。決済の検証と実行は Circle の hosted facilitator が行う。

1. 支払いなしで `GET /v1/records/{date}` を要求する
2. 402 と `PAYMENT-REQUIRED` ヘッダ（Base64 の支払い条件）が返る
3. 条件に沿って支払いを署名し、`PAYMENT-SIGNATURE` ヘッダを付けて同じ要求を再送する
4. 決済が成立すると 200 でレコードが返り、`PAYMENT-RESPONSE` ヘッダに成立の結果が入る

### 事前に必要なこと

支払いに用いる USDC は、Circle の Gateway Wallet（`0x0077777d7eba4688bdef3e311b846f25870a19b9`）へ預け入れておく必要がある。ウォレットに USDC を持っているだけでは決済が `insufficient_balance` となる。

```
approve(0x0077777d7eba4688bdef3e311b846f25870a19b9, 預ける額)  # USDC のコントラクトへ
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
