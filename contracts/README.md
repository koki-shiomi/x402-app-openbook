# 刻印のコントラクト

日次財務レコードのハッシュを Arc テストネットへ刻印するコントラクトを置く。仕様は [openspec/changes/anchor-daily-hash-on-arc/specs/anchor-registry/spec.md](../openspec/changes/anchor-daily-hash-on-arc/specs/anchor-registry/spec.md) を参照。

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

共有パッケージの `packages/shared/src/abi.ts` がコントラクトと一致することを、リポジトリのルートで確認する。

```bash
pnpm check:abi
```
