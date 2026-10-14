# 刻印のコントラクト

日次財務レコードのハッシュを Arc メインネットへ刻印するコントラクトを置く。仕様は [anchor-registry](../openspec/specs/anchor-registry/spec.md) を参照。

pnpm のワークスペースには含めず、Arc Foundry で扱う。導入手順は [Deploy on Arc](https://docs.arc.io/arc/tutorials/deploy-on-arc) を参照。

## 依存の復元

`lib/` はリポジトリに含めていない。次の 2 つで復元する。

```bash
arc-forge install foundry-rs/forge-std@v1.16.2 --no-git
arc-forge install OpenZeppelin/openzeppelin-contracts@v5.7.0 --no-git
```

## ビルドとテスト

```bash
arc-forge build
arc-forge test
```

## ABI の同期

コントラクトを変更したときは、次の出力を共有パッケージの `packages/shared/src/abi.ts` と照合し、同時に更新する。

```bash
arc-forge inspect src/AnchorRegistry.sol:AnchorRegistry abi --json
```

生成物との照合は手動で行い、ワークスペースのテストは生成物に依存しない。
