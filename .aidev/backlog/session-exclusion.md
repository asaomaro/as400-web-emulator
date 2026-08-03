# セッションの排他（自動操作と人間の同居）

**1 つの 5250 セッションを、ブラウザ・MCP・HLLAPI の 3 つが同時に触れる。**
書き込みが衝突する問題は `20260803-hllapi-bridge` で HLLAPI 側だけ塞いだ。
**MCP 側が残っている。**

## なぜ衝突するのか（`20260803-hllapi-bridge` で分かったこと）

5250 は**入力欄の値を AID と一緒に送る**。ブラウザは Enter を押すまで打ちかけを
手元に持っている（`sessions.ts` の `edits`）。その最中に別の書き手が画面を変えると、
打ちかけの行き先が消える。

HLLAPI がこの排他を仕様として持っている（`Reserve` 11 / `Release` 12）のはそのためで、
**「あれば良い機能」ではなく前提部品**だった。

## 実装済み（2026-08-03・`20260803-hllapi-bridge`）

締め出しの検査は `SessionManager.assertWritable` / `assertKeyAllowed` の**内側**にある。
書き込みの経路ごとに書くと足し忘れるため。`readOnly` ゲートと同じ場所。

```
assertWritable(id, user, holder?)   ← holder を渡さない＝人間扱い＝予約中は断る
```

- `SessionManager.reserve / release / forceRelease / touchReservation / reservationOf`
- 期限 2 分（呼び出しのたびに延長）。**落ちた自動化は `Release` を送れない**ため
- ブラウザ: 覆い＋「HLLAPI が自動操作中です」＋「解除して操作する」
- 実機 E2E で確認済み（`scripts/verify-hllapi-browser.mjs`）

## 残っている非対称

| | 予約できる | 予約中に締め出される |
|---|---|---|
| HLLAPI | ✅ | — |
| **MCP** | **❌** | ✅ |
| ブラウザ | ❌（解除だけ） | ✅ |

**MCP には予約する手段が無い。** いまは holder を渡さないので「人間と同じ」扱いになり、
長い自動操作の最中に人間やもう 1 つの MCP クライアントが同じ画面へ打つのを止められない。

## やること

- [ ] MCP に `reserve_session` / `release_session` ツールを足す。
      実装は `SessionManager.reserve` を呼ぶだけで、holder は `mcp:<user>`。
      **HLLAPI と別の holder にする**——別々の自動化が互いを締め出せる必要がある
- [ ] `run_steps` のような**複数手を続けて打つツールは自動で予約する**か検討する。
      利用者に「囲め」と言わせるより、道具の側で囲うほうが漏れない。
      ただし予約したまま落ちたときの見え方を先に決めること（期限はあるが 2 分は長い）
- [ ] `list_sessions` の出力に**予約中かどうか**を載せる。
      MCP のエージェントが「いま人が触っている」を知れないと、断られてから初めて気づく
- [ ] ブラウザ側から**人間が予約する**手段（「自動操作を止める」）が要るか検討する。
      いまは人間が締め出される側にしか回れない

## 参考

- `docs/HLLAPI.md`「排他 — `Reserve` / `Release`」
- `.aidev/works/20260803-hllapi-bridge/review.md`（ラウンド 2）
- 検証: `scripts/verify-hllapi-browser.mjs`（**MCP が予約中に締め出されることも見ている**）
