# レビュー記録

## ラウンド 1（2026-07-29T21:25Z）

差分: `fkeyLegend.ts`（`legendsInRow` の一般化＋検出 2 つ）/ `viewSettings.ts`（`optHints`）/
`ScreenGrid.vue`（オーバーレイ）/ `EmulatorPane.vue`（配線）/ `opMessages.ts`（文言）＋
実機 fixture 5 画面＋テスト 2 本。

### 指摘

- [must] **負のテストが規則を突けていなかった**。`wrkmsgq` / `menu` は凡例が無いから null に
  なっていただけで、「凡例と Opt 列が両方揃ったときだけ発火する」という肝心の規則が
  1 つもテストされていなかった（空振り検証で判明）。/ 対応: 修正（decisions D3）

- [must] 選択の反映が非フォーカス経路（`emit("edit")`）へ落ちており、
  カーソル・編集状態が打鍵時と食い違っていた。/ 対応: 修正（decisions D2）

### 規約適合

- 利用者に見える文言は `opMessages.ts`（`MSG_OPT_HINTS`）に置き、**テストは定数を参照**（AGENTS.md）
- `VIEW_ITEMS` へ足したので**画面設定メニューとキー設定の両方に自動で出る**（2 か所に書かない）
- 既定 OFF（推測を含む機能を勝手に有効化しない）
- コメントは why 中心。特に「なぜ mousedown を止めるのか」「なぜキーを購読しないのか」は
  干渉の中身つきで残した

### 再検証

- web-ui 94 files / 1083 tests 全通過
- `npm run build -w @as400web/web-ui`（vue-tsc 込み）通過

### 判定

**通過。** deliver へ進む。
