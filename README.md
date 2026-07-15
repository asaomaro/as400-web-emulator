# as400-web-emulator

AS400（IBM i）の 5250 画面を **MCP サーバー** と **Web エミュレーター** の 2 つのフロントから
操作できるようにするツール群。TN5250 プロトコルを純 TypeScript で実装する（外部 5250 ライブラリ・
ACS jar 非依存）。

主な対応機能: RFC 4777 自動サインオン、DBCS（日本語・SO/SI 桁維持）、TLS、27x132 ワイド画面、
フィールド編集（5250 上書き/挿入・キーバインド編集）、**拡張 5250 GUI コントロール**
（ウィンドウ・選択フィールド=ラジオ/チェック/プッシュボタン・スクロールバー）、
画面テキストの URL/メールのリンク化（Web）。

## 構成（npm workspaces モノレポ）

| パッケージ | 役割 |
|---|---|
| `packages/core` | TN5250 プロトコルコア（telnet ネゴシエーション・5250 データストリーム・画面モデル・EBCDIC⇔Unicode 変換・トレース/リプレイ） |
| `packages/server` | MCP サーバー（stdio + Streamable HTTP）・WebSocket/REST・web-ui 静的配信（subtask 02 で実装） |
| `packages/web-ui` | ブラウザ 5250 エミュレーター（Vue 3 + Vite。subtask 03 で実装） |
| `tools/gen-tables` | ICU .ucm → TS 変換テーブル生成（ビルド時ツール） |

## 開発

```sh
npm install
npm run build        # tsc -b（全パッケージ）
npm test             # vitest（全パッケージ）
npm run lint         # eslint
npm run gen:tables   # .ucm から変換テーブルを再生成（.ucm 更新時のみ）
```

- Node.js >= 20 / ESM。
- **ログは stderr のみ**（stdio MCP の stdout 汚染禁止）。`console.*` は lint で禁止、
  `@as400web/core` の `log`（pino/stderr）を使う。
- 検証環境: [PUB400.com](https://pub400.com)（要アカウント。資格情報は環境変数
  `PUB400_USER` / `PUB400_PASSWORD` で渡す）。

設計資料は `.aidev/works/20260714-5250-mcp-web-emulator/`（requirement / research / spec / design / plan）。
