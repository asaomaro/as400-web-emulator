# HLLAPI / EHLLAPI

既存の HLLAPI 資産（VB / C / Excel VBA など）から **ts5250 の 5250 セッションを駆動する**ための入口。

```
既存資産  ──hllapi(int*,char*,int*,int*)──▶  共有ライブラリ（Rust）
                                                  │ POST /api/hllapi
                                                  ▼
                                            ts5250 サーバー（TypeScript）
                                                  │
                                                  ▼
                                            5250 セッション
```

**ロジックは全部 TypeScript 側にある。** ネイティブの部品（DLL / .so）は
「C ABI ↔ HTTP」だけを担い、機能番号の意味も画面の解釈も持たない。
対応機能を増やしても、**利用者が DLL を差し替える必要は無い**。

## 使い方

### 1. ts5250 サーバーを起動する

```sh
./start.sh          # 既定 http://localhost:3400
```

### 2. 5250 セッションを開く

**HLLAPI の `Connect` はセッションを開かない**（既にある画面に繋ぐだけ）。
先に web-ui / MCP でセッションを開いておくこと。

### 3. 共有ライブラリから呼ぶ

```c
int  func = 1;                 /* Connect Presentation Space */
char data[1920] = "A";         /* 短縮名 */
int  len  = 1;
int  rc   = 0;
hllapi(&func, data, &len, &rc);   /* rc == 0 なら成功 */
```

エントリポイントは 4 つとも同じ実体: `hllapi` / `HLLAPI` / `WinHLLAPI` / `hllc`。

### 接続先と認証

| 環境変数 | 既定 | 用途 |
|---|---|---|
| `TS5250_HLLAPI_URL` | `http://127.0.0.1:3400/api/hllapi` | サーバーの場所 |
| `TS5250_API_TOKEN` | （なし） | 認証が有効なときの API トークン |

**TLS は張らない。** HLLAPI クライアントと ts5250 が同じ機の上にいる前提。
別の機を指す場合は経路の保護を利用者が用意すること。

## 文字コード — **CP932（Shift-JIS）**

**PS は 1 位置 = 1 バイト。全角は 2 バイトで、画面上でも 2 桁を占める。**
`24×80` の画面はちょうど **1920 バイト**に収まるので、既存資産が確保する
`rows × cols` の器がそのまま使える。

- 読み出し（`Copy PS` 等）は CP932 のバイト列で返る
- 書き込み（`Copy String to Field` 等）も CP932 で渡す
- CP932 に無い文字は `?`（1 バイト）に落ちる。**桁はずらさない**

> UTF-8 ではなく CP932 にしたのは、UTF-8 だと日本語 1 文字が 3 バイトになり、
> **1920 バイトの器に日本語画面が収まらない**ため（実機で確認）。

## 対応している機能

| # | 機能 | 備考 |
|---|---|---|
| 1 | Connect Presentation Space | `data[0]` が短縮名（`A`〜`Z`）。**セッションは開かない**。<br>`"A <指定>"` で狙ったセッションを指せる（下記） |
| 2 | Disconnect Presentation Space | **セッションは閉じない** |
| 3 | Send Key | ニーモニック（下記） |
| 4 | Wait | キーボードのロックが解けるまで。最大 30 秒 |
| 5 | Copy Presentation Space | **改行なしの固定長** |
| 6 | Search Presentation Space | 見つかった位置を `rc` に返す |
| 7 | Query Cursor Location | 位置を `rc` に返す |
| 8 | Copy PS to String | `rc`（入力）または現在のカーソルから |
| 10 | Query Sessions | 短縮名・ホスト・画面サイズ・**指定に使える名前** |
| 11 | Reserve | **自動操作の間、人間の入力を締め出す**（下記） |
| 12 | Release | 予約を外す |
| 15 | Copy String to Presentation Space | 入力欄のみ |
| 18 | Pause | `length` は 1/2 秒単位。最大 30 秒 |
| 20 | Query System | 実装の識別 |
| 22 | Query Session Status | |
| 30 | Search Field | 欄の中だけ |
| 31 | Find Field Position | 位置を `rc` に返す |
| 32 | Find Field Length | 長さを `rc` に返す |
| 33 | Copy String to Field | 欄の先頭から |
| 34 | Copy Field to String | |
| 40 | Set Cursor | |
| 99 | Convert Position or RowCol | `data[1]` が `P` / `R` |

**上記以外はすべて `rc=10`（`HRC_FUNCTION_UNAVAILABLE`）で断る。** 黙って成功にしない。

未対応の主なもの: Set Session Parameters (9)、Copy OIA (13)、
Query Field Attribute (14)、キーストローク傍受 (50〜53)、ファイル転送 (90/91)。

## どのシステムのどのセッションかを指定する

標準の `Connect` は短縮名 1 文字しか渡さないので、**開いた順**でしか指せない。
自動化にとってこれは危うい——順番が変われば別のシステムの本番画面を操作しうる。

そこで `Connect` のバッファに**続けて指定を書ける**ようにしてある（ts5250 の拡張）。

```vb
f = 1: d = "A 検証" & Space$(120): l = 128    ' セッション名で指す
Call hllapi(f, d, l, r)
```

指定に書けるもの（**大文字小文字は無視**、最初の NUL までを読む）:

| 書き方 | 例 |
|---|---|
| セッション設定の**名前** | `検証` |
| 設定の参照 | `srv:s-kensho` |
| `<システム参照>/<名前>` | `srv:osaka/検証` （名前が重なるとき） |
| 実行中のセッション id | `3f9c…` |

- **当たらなければ繋がない**（`rc=1`）。黙って別のセッションへ繋がない
- **同じ名前が 2 つ開いていたら断る**（`rc=11`）
- **指定を省けば従来どおり**（`"A"` だけ）——既存の資産はそのまま動く

指定に書ける名前は **`Query Sessions` (10) が出す**（4 列目）:

```
A 10.0.0.5 24x80 検証
```

> `Connect` は**セッションを開かない**（HLLAPI の仕様）。先に web-ui / MCP で開いておくこと。

## 排他 — `Reserve` / `Release`

**同じセッションをブラウザと自動化が同時に触る**のがこの実装の前提。
5250 セッションの実体はサーバーにあり、ブラウザはそれを見ている view にすぎない
（HLLAPI は 2 人目のクライアント）。

5250 は**入力欄の値を AID と一緒に送る**ので、ブラウザは Enter を押すまで打ちかけを
手元に持っている。その最中に自動化が画面を変えると、打ちかけの行き先が消える。
自動操作の前後を `Reserve` / `Release` で囲むこと。

```vb
f = 11: Call hllapi(f, d, l, r)   ' Reserve — 以降、人間は打てない
' ... 自動操作 ...
f = 12: Call hllapi(f, d, l, r)   ' Release
```

- 予約中、**ブラウザと MCP からの書き込みは断られる**（HTTP なら 409 / `SESSION_RESERVED`）。
  画面には「HLLAPI が自動操作中です」と出る
- 既に**別の使い手**が予約していれば `rc=11`
- **`Disconnect` (2) でも外れる**（正常終了したのに締め切ったままにしない）
- **2 分で自動的に切れる**。呼び出しのたびに延びる。
  接続層は状態を持たない＝**落ちた自動化は `Release` を送れない**ので、期限が要る
- それでも詰まったら、**画面の「解除して操作する」で利用者が取り戻せる**

> **MCP も同じ扱い**（予約中は締め出される）。ただし **MCP には予約する手段がまだ無い**
> ——`.aidev/backlog/session-exclusion.md`。

## キーのニーモニック

`@` を接頭辞にする。**普通の文字はそのまま入力**（`"ABC@E"` = ABC を打って Enter）。

| | | | |
|---|---|---|---|
| `@E` Enter | `@C` Clear | `@P` Print | `@@` 文字の `@` |
| `@1`〜`@9` F1〜F9 | `@a`〜`@o` F10〜F24 | `@A@H` SysReq | `@A@Q` Attn |
| `@T` Tab | `@B` BackTab | `@0` Home | `@U/@V/@L/@Z` カーソル |

### 写せないキーは `rc=20`

ニーモニックの表は **3270 由来**で、`PA1`〜`PA3`（`@x`/`@y`/`@z`）のように
**5250 に無いキー**が含まれる。これらは `HRC_UNDEFINED_COMBINATION`(20) で断る。

**写せないキーが 1 つでも混ざっていたら、何も送らずに断る**——
一部だけ送ると画面が半端な状態で残り、呼び出し側から復旧できないため。

### 画面を書き換えるローカル操作は未対応

`@F`（Erase EOF）・`@D`（Delete）・`@<`（Back Erase）・`@N`（New Line）・`@R`（Reset）は
**カーソル位置を動かすだけ**で、画面の書き換えは行わない。
消したいときは `Copy String to Field` で空白を書くこと。

## 戻り値

| コード | 意味 |
|---|---|
| 0 | 成功 |
| 1 | 短縮名に対応するセッションが無い |
| 2 | パラメータの誤り（ヌルポインタ・不正な短縮名） |
| 4 | ビジー（Wait が時間切れ） |
| 5 | 書けない（保護欄・欄の外・キーボードロック・**読み取り専用のセッション**） |
| 6 | 切り詰めた（バッファに収まらない） |
| 7 | 位置が無効／**検索で見つからない** |
| 8 | 呼ぶ順序が違う（接続していない） |
| 9 | システムエラー（**サーバーへ届かない**） |
| 10 | **未対応の機能** |
| 11 | 他の使い手が予約している（`Reserve`） |
| 20 | 写せないキー |
| 26 | Pause の途中で画面が変わった |
| 28 | 欄の長さが 0 |

## ビルド

```sh
cd crates/hllapi
cargo build --release
```

- Linux → `target/release/libts5250hllapi.so`
- Windows（64bit）→ `--target x86_64-pc-windows-msvc`
- Windows（32bit）→ `--target i686-pc-windows-msvc`

**外部クレートを使っていない**ので、レジストリへ取りに行かずにビルドできる。

### 呼び出し規約

エクスポートは **`extern "system"`**——32bit Windows では `stdcall`、それ以外では `C`。
WinHLLAPI と VB / VBA の `Declare` は既定が `stdcall` なので、`extern "C"`（cdecl）だと
**32bit Office からの呼び出しでスタックが壊れる**。64bit では規約が 1 つしかないので違いは出ない。

**Office と DLL のビット数は合わせること。** 合っていないと
「指定されたモジュールが見つかりません」になる（パスの問題ではない）。

## Excel / VBA から使う

- `docs/hllapi-sample.bas` — VBE の「ファイル」→「ファイルのインポート」で読み込む。
  `Connect` / `Reserve` / `CopyScreen` などのラッパと、動く例が 4 つ入っている
- `scripts/make-hllapi-xlsm.ps1` — 上記を組み込んだ `.xlsm` を **Windows 上の Excel に作らせる**
  （`.xlsm` の VBA プロジェクトは OLE 複合ファイルなので Linux 側では組めない）

```powershell
pwsh -File scripts\make-hllapi-xlsm.ps1 -DllPath C:\ts5250\ts5250hllapi.dll
```

**文字コードの変換は書かなくてよい。** VBA の `Declare` は `ByVal ... As String` を
ANSI（日本語 Windows では CP932）へ自動変換して渡し、戻りで書き戻す。
DLL 側も CP932 なので、`Space$(1920)` の器がそのまま画面 1 枚になる。

```vb
Dim s As String
s = CopyScreen()                 ' 1920 バイト
MsgBox ScreenLine(s, 1)          ' 1 行目（Mid で切れる）
```

> ⚠ **VBA からの実行は確かめていない**（この開発環境に Windows と Excel が無い）。
> C ABI としては Python の `ctypes` で 33 件通っているが、
> **VBA の `Declare` を通した動作は未検証**。

### ⚠ Windows は未検証

開発環境（WSL2 の Linux）に mingw / MSVC が無く、**Windows 版はビルドも動作確認もしていない**。
クレートは OS 非依存（`std::net` のみ）に書いてあるが、**動作は主張しない**。
HLLAPI の実利用者はほぼ Windows なので、**最初に確かめるべきはここ**。

### この開発環境での回避策（普通の環境では不要）

C コンパイラが無く `sudo` も使えないため、次を環境変数で渡している。
**リポジトリには焼き込んでいない**（他の環境では不要で、むしろ邪魔になる）。

```sh
# 実行時ライブラリへの開発用シンボリックリンクを作る
L=/tmp/fakelib; mkdir -p $L
for n in c m dl pthread rt util gcc_s; do
  ln -sf $(ls /usr/lib/x86_64-linux-gnu/lib$n.so.* | head -1) $L/lib$n.so
done
export CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER=rust-lld
export RUSTFLAGS="-L $L"
cargo build --release --features selftest
```

**テスト実行ファイルはリンクできない**（`crt1.o` が無い）ので `cargo test` が動かない。
代わりに `selftest` フィーチャで検査を共有ライブラリから走らせられる
——**中身は `cargo test` と同じ関数**（`src/selftest.rs`）なので、二重に書いていない。

## 検証

```sh
node --env-file=.env scripts/verify-hllapi-osaka.mjs
```

**本物の C ABI**（Python の `ctypes` で共有ライブラリを動的リンク）で、
実機のセッションに対して Connect → Copy PS → Search → Disconnect を通す。

## 設計の要点

- **1 呼び出し = HTTP 1 往復。** ネイティブ側に状態も相関も持たせない。
  短縮名の対応表も論理カーソルも TypeScript 側が持つ。
- **バイト列は base64 で運ぶ。** JSON はテキストしか運べないので、
  CP932 のバイト列をそのまま通すために挟む。ネイティブ側は符号を解くだけで、中身を解釈しない。
- この「薄さ」は `packages/server/test/hllapi-bridge-thinness.test.ts` が
  **Rust のソースを走査して固定**している
  （機能名・機能番号での分岐・可変の状態・外部依存が無いこと）。
  **`cargo test` 側に置いていない**のは、この環境では C コンパイラが無くテスト実行ファイルを
  リンクできず、標準の検査（`npm test`）でも走らないため——**走らない検査は無いのと同じ**。
