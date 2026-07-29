# テスト結果

## 実行サマリ

| パッケージ | Test Files | Tests | 結果 |
|---|---|---|---|
| core | 79 | 914 | **全通過** |
| web-ui | 90 | 1054 | **全通過** |
| server | 50 | 646 | 642 通過 / **4 失敗**（下記） |
| ebcdic | 8 | 83 | **全通過** |
| scs | — | 13 | **全通過** |
| **合計** | | **2710** | **2706 通過 / 4 失敗** |

- **skip / todo は 0 件**（全ランナーで skip 出力なし）。
- ビルド: `npm run build`（tsc -b）と `npm run build -w @as400web/web-ui`（**vue-tsc -b + vite build**）が通る。
- lint: 変更したファイルはエラー 0。`npm run lint` 全体では 6 件のエラーが出るが、
  **すべて未追跡の作業中スクリプト**（`scripts/shot-*.mjs` / `build-empsfl-osaka.mjs`）で本作業とは無関係。

### 失敗 4 件は環境要因（本作業と無関係）

`packages/server/test/zip-writer.test.ts > 外部の unzip が受け付けること` の 4 件。
`which unzip` が空＝**`unzip` コマンドが未導入**の環境要因で、本作業は server に一切触れていない
（変更は core 4 ファイル・web-ui 1 ファイル＋テスト 2 本）。

## 受け入れ基準の検証

| requirement の完了条件 | 判定 | 根拠 |
|---|---|---|
| `ApplyResult` と `ScreenSnapshot` に矩形と CLEAR 有無が載る | ✅ | `write-extent.test.ts` の全 13 ケースが `res.lastWrite` を検証。「snapshot への露出」で `snap.lastWrite` も確認 |
| 既存 4 本が改修前と同じく通る | ✅ | `window-view` / `stacked-window` / `reverse-frame-window` / `pane-cursor-window` = **48 テスト全通過**。4 本とも矩形の**厳密値**を assert しているため、通過＝挙動が同一 |
| 実測 4 画面の回帰テストがあり ③④ が窓と判定されない | ✅ | `window-write-extent.test.ts`「誤検出を弾く」。③（帳票）④（反転バナー）とも `lastWrite` 付きで `null` |
| ① は引き続き窓と判定され枠位置も従来どおり | ✅ | 同ファイル「本物の窓は通す」で `expect(withExtent).toEqual(without)`＝**矩形が改修前と同一**であることを直接 assert |
| ② は従来どおり null | ✅ | 同ファイルに ②（PDM 風の `---` 区切り 2 本・縦罫なし）を**test 工程で追加**。`lastWrite` の有無どちらでも `null` |
| テストが空振りでない | ✅ | 下記「空振り検証」 |

## 空振り検証（門を外すと落ちるか）

`detectWindowRect` の `if (ruledOutByWriteExtent(snap)) return null;` を一時的に削除して実行:

```
× ③ 帳票は罫線が揃っていても窓と判定しない
× ④ 反転バナーは閉じた矩形でも窓と判定しない
× RESTORE SCREEN（窓を閉じた直後）は窓と判定しない
× メッセージ行だけの書き換えは窓と判定しない（小さすぎる更新）
× 細すぎる書き込みは窓と判定しない
× 1 セルも書いていないレコードでは窓と判定しない
× CLEAR 付きで画面の一部しか書かなくても窓と判定しない（実測 96% の遷移）
Tests  7 failed | 3 passed (10)
```

**7 件が落ちる**＝テストが実際に判定を捕まえている。門を戻して 11/11 通過を確認済み。

さらに ③④ のケースは `lastWrite` **無し**で `not.toBeNull()` も assert しており、
**改修前は誤検出していたことをテスト自身が示している**（回帰の再現を兼ねる）。

## 未検証の穴（deliver へ引き継ぐ）

- **実機の窓レコードでの検証**（decisions D4）。実機へ接続はできるが認証情報が無く、
  窓を開いたときの `lastWrite` を実測できていない。通常画面側は**実機採取レコードの再生で実測済み**
  （`pub400-*.jsonl` の 6/6 で CLEAR を確認）で、判定の第一級条件はその実データに基づく。
  窓側は合成ストリームで担保している。
- **`nullNonBypass`（CC1）を数えない判断**は、実機で CC1 がどう使われているかを確認したうえでの
  判断ではない（安全側に倒した。decisions は spec 方針4・`buffer.ts` のコメントに理由を記載）。
  合成ストリームでは「数えていたら矩形が膨らむ」ことをテストで固定している。

## 判定

**全受け入れ基準を満たす。** 未解決の失敗なし（server の 4 件は `unzip` 未導入の環境要因）。
→ review 工程へ進む。
