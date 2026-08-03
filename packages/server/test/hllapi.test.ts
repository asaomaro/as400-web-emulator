import { describe, it, expect, vi } from "vitest";
import { callHllapi, HllapiState, type HllapiDeps } from "../src/hllapi.js";
import { HF, HRC } from "../src/hllapi-types.js";
import type { SessionManager } from "../src/session-manager.js";
import { encodeCp932, decodeCp932 } from "../src/hllapi-cp932.js";
import type { Cell, CellKind, Field, ScreenSnapshot } from "@ts5250/tn5250";

/**
 * 機能番号の分岐。
 *
 * 一番大事なのは **未実装が黙って成功にならない**こと（既定が `rc=10`）。
 * 実機は要らない——`SessionManager` を偽物に差し替える。
 */
const cell = (char: string, kind: CellKind = "sbcs"): Cell => ({
  char,
  kind,
  color: "green",
  reverse: false,
  underline: false,
  blink: false,
  columnSeparator: false,
  nonDisplay: false
});

const field = (over: Partial<Field> & { index: number; row: number; col: number; length: number }): Field => ({
  protected: false,
  hidden: false,
  numeric: false,
  ...over
});

function snap(opts: {
  text?: string[];
  fields?: Field[];
  rows?: number;
  cols?: number;
  locked?: boolean;
  cursor?: { row: number; col: number };
}): ScreenSnapshot {
  const rows = opts.rows ?? 2;
  const cols = opts.cols ?? 10;
  const cells: Cell[][] = [];
  for (let r = 0; r < rows; r++) {
    const line: Cell[] = [];
    for (const ch of opts.text?.[r] ?? "") {
      // 全角は lead ＋ tail の 2 セル（実物と同じ持ち方）
      if (encodeCp932(ch).bytes.length === 2) line.push(cell(ch, "dbcs-lead"), cell("", "dbcs-tail"));
      else line.push(cell(ch));
    }
    while (line.length < cols) line.push(cell(" "));
    cells.push(line.slice(0, cols));
  }
  return {
    sessionId: "s1",
    rows: rows as 24,
    cols: cols as 80,
    cursor: opts.cursor ?? { row: 1, col: 1 },
    keyboardLocked: opts.locked ?? false,
    cells,
    fields: opts.fields ?? []
  };
}

/** 偽の SessionManager。**実機に触らずに分岐だけ検証する** */
function fakeDeps(opts: {
  snapshot?: ScreenSnapshot;
  sessions?: { id: string; connectedAt: string }[];
  setField?: (t: unknown, v: string) => void;
  sendAid?: ReturnType<typeof vi.fn>;
  keyAllowed?: boolean;
  writable?: boolean;
} = {}): { deps: HllapiDeps; sendAid: ReturnType<typeof vi.fn>; setField: ReturnType<typeof vi.fn> } {
  const snapshot = opts.snapshot ?? snap({});
  const sendAid = opts.sendAid ?? vi.fn(async () => ({ screen: snapshot, timedOut: false }));
  const setField = vi.fn(opts.setField ?? (() => undefined));
  const entries = (opts.sessions ?? [{ id: "s1", connectedAt: "2026-08-03T00:00:00Z" }]).map((e) => ({
    id: e.id,
    connectedAt: e.connectedAt,
    host: "h",
    session: { snapshot: () => snapshot, sendAid, setField }
  }));
  const sessions = {
    list: () => entries,
    get: (id: string) => {
      const found = entries.find((e) => e.id === id);
      if (!found) throw new Error("no session");
      return found;
    },
    assertKeyAllowed: () => {
      if (opts.keyAllowed === false) throw new Error("read only");
    },
    assertWritable: () => {
      if (opts.writable === false) throw new Error("read only");
    }
  } as unknown as SessionManager;
  return {
    deps: { sessions, state: new HllapiState(), sleep: async () => undefined },
    sendAid,
    setField
  };
}

/** **バッファは CP932 バイト列の base64** で運ぶ（`hllapi-types.ts` の注記） */
const b64 = (s: string): string => Buffer.from(encodeCp932(s).bytes).toString("base64");
/** 応答のバッファを読みやすい文字列へ戻す */
const text = (r: { dataB64?: string }): string =>
  r.dataB64 === undefined ? "" : decodeCp932(new Uint8Array(Buffer.from(r.dataB64, "base64")));

const call = (deps: HllapiDeps, fn: number, over: Partial<{ data: string; length: number; pos: number }> = {}) =>
  callHllapi(deps, {
    function: fn,
    dataB64: b64(over.data ?? ""),
    length: over.length ?? 0,
    pos: over.pos ?? 0
  });

async function connected(opts: Parameters<typeof fakeDeps>[0] = {}) {
  const f = fakeDeps(opts);
  const r = await call(f.deps, HF.CONNECT_PS, { data: "A" });
  expect(r.rc).toBe(HRC.SUCCESSFUL);
  return f;
}

describe("未実装の扱い", () => {
  it("**未実装の機能番号は rc=10**（黙って成功にしない）", async () => {
    const { deps } = await connected();
    for (const fn of [HF.SET_SESSION_PARAMETERS, HF.RESERVE, HF.COPY_OIA, HF.SEND_FILE, HF.GET_KEY]) {
      expect((await call(deps, fn)).rc).toBe(HRC.FUNCTION_UNAVAILABLE);
    }
  });

  it("知らない番号も rc=10", async () => {
    const { deps } = await connected();
    expect((await call(deps, 777)).rc).toBe(HRC.FUNCTION_UNAVAILABLE);
  });
});

describe("接続", () => {
  it("開いているセッションへ短縮名を割り当てる", async () => {
    const { deps } = fakeDeps();
    expect((await call(deps, HF.CONNECT_PS, { data: "A" })).rc).toBe(HRC.SUCCESSFUL);
  });

  it("**セッションが無ければ rc=1**（Connect は新しく開かない）", async () => {
    const { deps } = fakeDeps({ sessions: [] });
    expect((await call(deps, HF.CONNECT_PS, { data: "A" })).rc).toBe(HRC.PS_ID_INVALID);
  });

  it("短縮名が 1 文字の英字でなければ rc=2", async () => {
    const { deps } = fakeDeps();
    expect((await call(deps, HF.CONNECT_PS, { data: "1" })).rc).toBe(HRC.PARAMETER_ERROR);
    expect((await call(deps, HF.CONNECT_PS, { data: "" })).rc).toBe(HRC.PARAMETER_ERROR);
  });

  it("**接続していない状態で操作すると rc=8**（呼ぶ順序が違う）", async () => {
    const { deps } = fakeDeps();
    expect((await call(deps, HF.COPY_PS)).rc).toBe(HRC.PROCEDURE_ERROR);
  });

  it("Disconnect のあとは再び rc=8", async () => {
    const { deps } = await connected();
    expect((await call(deps, HF.DISCONNECT_PS, { data: "A" })).rc).toBe(HRC.SUCCESSFUL);
    expect((await call(deps, HF.COPY_PS)).rc).toBe(HRC.PROCEDURE_ERROR);
  });
});

describe("画面の読み出し", () => {
  it("Copy PS は改行なしの固定長", async () => {
    const { deps } = await connected({ snapshot: snap({ text: ["AB", "CD"], rows: 2, cols: 4 }) });
    const r = await call(deps, HF.COPY_PS);
    expect(text(r)).toBe("AB  CD  ");
  });

  it("**バッファに収まらなければ rc=6**（切り詰めを黙らない）", async () => {
    const { deps } = await connected({ snapshot: snap({ text: ["ABCD"], rows: 1, cols: 4 }) });
    const r = await call(deps, HF.COPY_PS, { length: 2 });
    expect(r.rc).toBe(HRC.DATA_ERROR);
    expect(text(r)).toBe("AB");
  });

  it("Search PS は**見つかった位置を rc に返す**", async () => {
    const { deps } = await connected({ snapshot: snap({ text: ["  FIND"], rows: 1, cols: 6 }) });
    expect((await call(deps, HF.SEARCH_PS, { data: "FIND" })).rc).toBe(3);
  });

  it("見つからなければ rc=7", async () => {
    const { deps } = await connected({ snapshot: snap({ text: ["ABC"], rows: 1, cols: 3 }) });
    expect((await call(deps, HF.SEARCH_PS, { data: "ZZ" })).rc).toBe(HRC.PS_POSITION_INVALID);
  });

  it("Query Cursor Location は位置を rc に返す", async () => {
    const { deps } = await connected({ snapshot: snap({ rows: 2, cols: 10, cursor: { row: 2, col: 3 } }) });
    expect((await call(deps, HF.QUERY_CURSOR_LOCATION)).rc).toBe(13);
  });
});

describe("書き込み", () => {
  it("入力欄へ書ける", async () => {
    const f = field({ index: 1, row: 1, col: 1, length: 4 });
    const { deps, setField } = await connected({ snapshot: snap({ text: ["    "], fields: [f], rows: 1, cols: 4 }) });
    const r = await call(deps, HF.COPY_STRING_TO_FIELD, { data: "AB", pos: 1 });
    expect(r.rc).toBe(HRC.SUCCESSFUL);
    expect(setField).toHaveBeenCalledWith({ index: 1 }, "AB  ");
  });

  it("**保護欄には書けない（rc=5）**", async () => {
    const f = field({ index: 1, row: 1, col: 1, length: 4, protected: true });
    const { deps, setField } = await connected({ snapshot: snap({ text: ["    "], fields: [f], rows: 1, cols: 4 }) });
    expect((await call(deps, HF.COPY_STRING_TO_PS, { data: "AB", pos: 1 })).rc).toBe(HRC.FUNCTION_INHIBITED);
    expect(setField).not.toHaveBeenCalled();
  });

  it("欄の外にも書けない（rc=5）", async () => {
    const { deps } = await connected({ snapshot: snap({ text: ["    "], fields: [], rows: 1, cols: 4 }) });
    expect((await call(deps, HF.COPY_STRING_TO_PS, { data: "AB", pos: 1 })).rc).toBe(HRC.FUNCTION_INHIBITED);
  });

  it("**欄に収まらなければ rc=6**（切り詰めを黙らない）", async () => {
    const f = field({ index: 1, row: 1, col: 1, length: 2 });
    const { deps, setField } = await connected({ snapshot: snap({ text: ["  "], fields: [f], rows: 1, cols: 2 }) });
    expect((await call(deps, HF.COPY_STRING_TO_FIELD, { data: "ABCD", pos: 1 })).rc).toBe(HRC.DATA_ERROR);
    expect(setField).toHaveBeenCalledWith({ index: 1 }, "AB");
  });
});

describe("キー送信", () => {
  it("AID キーを送る", async () => {
    const { deps, sendAid } = await connected();
    expect((await call(deps, HF.SEND_KEY, { data: "@E" })).rc).toBe(HRC.SUCCESSFUL);
    expect(sendAid).toHaveBeenCalledWith("Enter", expect.anything());
  });

  it("**写せないキーがあれば何も送らずに rc=20**", async () => {
    const { deps, sendAid } = await connected();
    // `@x` は PA1（5250 に無い）。前に @E があっても**送らない**
    expect((await call(deps, HF.SEND_KEY, { data: "@E@x" })).rc).toBe(HRC.UNDEFINED_COMBINATION);
    expect(sendAid).not.toHaveBeenCalled();
  });

  it("キーボードロック中の文字入力は rc=5", async () => {
    const f = field({ index: 1, row: 1, col: 1, length: 4 });
    const { deps } = await connected({
      snapshot: snap({ text: ["    "], fields: [f], rows: 1, cols: 4, locked: true })
    });
    expect((await call(deps, HF.SEND_KEY, { data: "AB" })).rc).toBe(HRC.FUNCTION_INHIBITED);
  });

  it("**読み取り専用のセッションへは書き込めない（rc=5）**", async () => {
    // 画面や MCP で塞いでいる境界を、HLLAPI から横に破らせない
    const f = field({ index: 1, row: 1, col: 1, length: 4 });
    const { deps, setField } = await connected({
      snapshot: snap({ text: ["    "], fields: [f], rows: 1, cols: 4 }),
      writable: false
    });
    expect((await call(deps, HF.COPY_STRING_TO_FIELD, { data: "AB", pos: 1 })).rc).toBe(
      HRC.FUNCTION_INHIBITED
    );
    expect(setField).not.toHaveBeenCalled();
  });

  it("**読み取り専用のセッションでは AID を送らない（rc=5）**", async () => {
    const { deps, sendAid } = await connected({ keyAllowed: false });
    expect((await call(deps, HF.SEND_KEY, { data: "@E" })).rc).toBe(HRC.FUNCTION_INHIBITED);
    expect(sendAid).not.toHaveBeenCalled();
  });

  it("文字を打ってから Enter を送れる", async () => {
    const f = field({ index: 1, row: 1, col: 1, length: 4 });
    const { deps, sendAid, setField } = await connected({
      snapshot: snap({ text: ["    "], fields: [f], rows: 1, cols: 4 })
    });
    expect((await call(deps, HF.SEND_KEY, { data: "AB@E" })).rc).toBe(HRC.SUCCESSFUL);
    expect(setField).toHaveBeenCalledWith({ index: 1 }, "AB  ");
    expect(sendAid).toHaveBeenCalledWith("Enter", expect.anything());
  });
});

describe("日本語（DBCS）", () => {
  it("**全角を含む画面がバイト単位で正しく返る**", async () => {
    const { deps } = await connected({ snapshot: snap({ text: ["サイン"], rows: 1, cols: 10 }) });
    const r = await call(deps, HF.COPY_PS);
    expect(r.rc).toBe(HRC.SUCCESSFUL);
    expect(r.length).toBe(10); // 桁数 = バイト数
    expect(text(r)).toBe("サイン    ");
  });

  it("**日本語で検索できる**（文字列連結だった頃は引けなかった）", async () => {
    const { deps } = await connected({ snapshot: snap({ text: ["  サイン"], rows: 1, cols: 10 }) });
    expect((await call(deps, HF.SEARCH_PS, { data: "サイン" })).rc).toBe(3);
  });

  it("全角を入力欄へ書ける", async () => {
    const f = field({ index: 1, row: 1, col: 1, length: 6 });
    const { deps, setField } = await connected({
      snapshot: snap({ text: ["      "], fields: [f], rows: 1, cols: 6 })
    });
    expect((await call(deps, HF.COPY_STRING_TO_FIELD, { data: "あ", pos: 1 })).rc).toBe(HRC.SUCCESSFUL);
    expect(setField).toHaveBeenCalledWith({ index: 1 }, expect.stringContaining("あ"));
  });
});

describe("カーソル", () => {
  it("Set Cursor は範囲内なら成功、範囲外は rc=7", async () => {
    const { deps } = await connected({ snapshot: snap({ rows: 2, cols: 10 }) });
    expect((await call(deps, HF.SET_CURSOR, { pos: 15 })).rc).toBe(HRC.SUCCESSFUL);
    expect((await call(deps, HF.SET_CURSOR, { pos: 21 })).rc).toBe(HRC.PS_POSITION_INVALID);
  });

  it("Set Cursor のあと Copy PS to String がそこから読む", async () => {
    const { deps } = await connected({ snapshot: snap({ text: ["ABCDE"], rows: 1, cols: 5 }) });
    await call(deps, HF.SET_CURSOR, { pos: 3 });
    expect(text(await call(deps, HF.COPY_PS_TO_STRING, { length: 2 }))).toBe("CD");
  });
});

describe("欄の問い合わせ", () => {
  it("Find Field Position / Length は rc に返す", async () => {
    const f = field({ index: 1, row: 1, col: 3, length: 4 });
    const { deps } = await connected({ snapshot: snap({ text: ["  ABCD"], fields: [f], rows: 1, cols: 8 }) });
    expect((await call(deps, HF.FIND_FIELD_POSITION, { pos: 4 })).rc).toBe(3);
    expect((await call(deps, HF.FIND_FIELD_LENGTH, { pos: 4 })).rc).toBe(4);
  });

  it("Copy Field to String", async () => {
    const f = field({ index: 1, row: 1, col: 3, length: 4 });
    const { deps } = await connected({ snapshot: snap({ text: ["  ABCD"], fields: [f], rows: 1, cols: 8 }) });
    expect(text(await call(deps, HF.COPY_FIELD_TO_STRING, { pos: 3 }))).toBe("ABCD");
  });

  it("欄が無ければ rc=7", async () => {
    const { deps } = await connected({ snapshot: snap({ text: ["    "], fields: [], rows: 1, cols: 4 }) });
    expect((await call(deps, HF.FIND_FIELD_POSITION, { pos: 1 })).rc).toBe(HRC.PS_POSITION_INVALID);
  });
});

describe("セッションを要さない機能", () => {
  it("Convert Position or RowCol（P: 位置 → 行桁）", async () => {
    const { deps } = fakeDeps();
    const r = await call(deps, HF.CONVERT_POS_ROWCOL, { data: "AP 24x80", pos: 81 });
    expect(text(r)).toBe("2 1");
  });

  it("Convert（R: 行桁 → 位置）", async () => {
    const { deps } = fakeDeps();
    expect((await call(deps, HF.CONVERT_POS_ROWCOL, { data: "AR 24x80", pos: 2, length: 1 })).rc).toBe(81);
  });

  it("2 文字目が P/R でなければ rc=2", async () => {
    const { deps } = fakeDeps();
    expect((await call(deps, HF.CONVERT_POS_ROWCOL, { data: "AX" })).rc).toBe(HRC.PARAMETER_ERROR);
  });

  it("**接続していなくても Query System は答える**", async () => {
    const { deps } = fakeDeps();
    const r = await call(deps, HF.QUERY_SYSTEM);
    expect(r.rc).toBe(HRC.SUCCESSFUL);
    expect(text(r)).toContain("ts5250");
  });
});

describe("待ち", () => {
  it("ロックが解けていれば Wait は即成功", async () => {
    const { deps } = await connected({ snapshot: snap({ locked: false }) });
    expect((await call(deps, HF.WAIT)).rc).toBe(HRC.SUCCESSFUL);
  });

  it("**ロックしたままなら時間切れで rc=4**（無限に待たない）", async () => {
    const { deps } = await connected({ snapshot: snap({ locked: true }) });
    expect((await call(deps, HF.WAIT)).rc).toBe(HRC.PS_BUSY);
  });
});
