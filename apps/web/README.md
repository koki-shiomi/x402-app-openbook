# @openbook/web

有料 API で何が取得できるかを確かめるための画面。日次データの主たる取得経路は API そのものであり、この画面はその内容を確かめるためのものである。仕様は [openspec/specs/public-dashboard/spec.md](../../openspec/specs/public-dashboard/spec.md) を参照。

## テストの前提

テストは実ブラウザ（Chromium）で実行する。ブラウザ本体と、その実行に必要なシステムライブラリの両方が要る。

```
pnpm --filter @openbook/web exec playwright install chromium   # ブラウザ本体
sudo pnpm --filter @openbook/web exec playwright install-deps chromium   # システムライブラリ
```

後者は `libnss3` と `libnspr4` を入れる。これらが無いと、ブラウザは起動直後に
`error while loading shared libraries: libnspr4.so` で終了する。
