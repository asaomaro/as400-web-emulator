# レビュー記録

## ラウンド 1（2026-07-29T19:50Z）

差分: core 4 ファイル（`types.ts` / `buffer.ts` / `wtd-applier.ts` / `index.ts`）＋
web-ui 1 ファイル（`fkeyLegend.ts`）＋新規テスト 2 本。

### 要件適合

requirement の完了条件はすべて満たしている（`test-result.md` の対応表）。
spec からの逸脱は `decisions.md` D1〜D4 に記録済みで、いずれも理由が立っている。

### 指摘

- [should] `packages/core/src/screen/buffer.ts:186-196` **`noteWriteRange` の JSDoc が
  `noteClear` の上に取り残されている**。`noteWriteRange` を追加したあとに `noteClear` を
  その前へ挿入したため、「線形範囲 `from..to` を…」というヘッダが `noteClear` に付き、
  `noteWriteRange` 自体は無注釈になった。AGENTS.md「関数の責務は JSDoc ヘッダで」に反し、
  かつ**読み手を積極的に誤らせる**（クリアの関数が範囲の説明を持っている）。
  / 対応: 修正

- [should] `packages/core/src/screen/buffer.ts:150-153` **`get lastWrite()` に副作用がある**。
  getter が `commitWrite()` を呼び、確定値へ移したうえで `pending` をリセットする。
  レコード適用の**途中**でこれを読むと、そこまでの書き込みが確定して `pending` が空になり、
  同じレコードの残りだけが新しい `pending` に積まれる＝**最終的な extent から前半が消える**。
  現在の呼び出し順（`applyDataStream` が終わってから `snapshot()`）では到達しないが、
  `snapshot()` がこの getter を呼ぶ以上、レコード処理中に snapshot を取る経路が
  1 つできた時点で**静かに壊れる**。読み取りは純粋にすべき。
  / 対応: 修正（確定は `beginRecord()` だけが行い、getter は計算して返すだけにする）

- [nit] `packages/core/src/screen/buffer.ts:321` `blankWindowArea` がセルごとに `noteWrite` を
  呼ぶ。外接矩形なので四隅だけで足りる。既存の二重ループの中なので実害は小さく、
  行数を増やしてまで畳む価値は薄い。/ 対応: 許容

- [nit] `WriteExtent.cells` が判定に使われていない（型定義に「余地を残す」と明記済み）。
  また `noteWriteRange` は同じセルへの重複書き込みを二重計上しうる。
  判定に使っていないため実害なし。使うことになった時点で意味を決め直す。/ 対応: 許容

### 規約適合

- コメントは why 中心で、非自明な判断（`nullNonBypass` を数えない・書き込み無しレコードで
  前回値を残す・`lastWrite` を任意にした）に理由が書かれている（AGENTS.md）。
- core に Node API 依存は増えていない。追加は数値の min/max 更新のみ。
- `browser.ts` を広げていない（web-ui は型としてのみ使う）。
- 利用者に見えるメッセージの追加は無し。

### 判定

**should 2 件により coding へ差し戻す。**

## ラウンド 2（2026-07-29T19:56Z）

ラウンド 1 の should 2 件の修正を確認した。

- `noteWriteRange` に自身の JSDoc が付き、`noteClear` の説明と分離された。
- `lastWrite` getter が純粋になった。確定（`committedWrite` への移し替え）は
  `beginRecord()` だけが行い、getter は `pending` の内容から値を組み立てて返す。
  レコード途中で読んでも記録が壊れない。
  - 併せて `commitWrite()` を廃し、`pendingHasContent()` / `extentOf()` の 2 つの純関数へ分解した。
    状態を持つのは `beginRecord()` の 1 箇所だけになり、追いやすさが上がっている。

### 指摘

なし（新規の指摘は無い。ラウンド 1 の nit 2 件は許容のまま）。

### 再検証

- core 79 files / 915 tests 全通過（`write-extent.test.ts` に getter の純粋性を確かめる
  ケースを 1 件追加したため +1）
- web-ui 90 files / 1054 tests 全通過（既存 4 本を含む）
- `npm run build`（tsc -b）・`npm run build -w @as400web/web-ui`（vue-tsc 込み）通過

### 判定

**通過。** deliver へ進む。
