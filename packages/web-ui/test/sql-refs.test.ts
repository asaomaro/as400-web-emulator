import { describe, it, expect } from "vitest";
import { tableRefsOf, qualifierAt, resolveQualifier } from "../src/sqlRefs.js";

/**
 * `別名.` から列の候補を出すための下ごしらえ。
 *
 * **構文解析器は書かない**方針なので、外したときに「候補が出ないだけ」で済むことも
 * 一緒に確かめる（誤った表を指してはいけない）。
 */
describe("表の参照を拾う", () => {
  it("FROM の表とライブラリー", () => {
    expect(tableRefsOf("SELECT * FROM ASAOLIB.M_MENU")).toEqual([
      { schema: "ASAOLIB", name: "M_MENU" }
    ]);
  });

  it("IBM i の `LIB/TABLE` 表記も受ける", () => {
    expect(tableRefsOf("SELECT * FROM ASAOLIB/M_MENU")).toEqual([
      { schema: "ASAOLIB", name: "M_MENU" }
    ]);
  });

  it("別名（AS 付き・無し）を拾う", () => {
    expect(tableRefsOf("SELECT * FROM ASAOLIB.M_MENU T1")).toEqual([
      { schema: "ASAOLIB", name: "M_MENU", alias: "T1" }
    ]);
    expect(tableRefsOf("SELECT * FROM ASAOLIB.M_MENU AS T1")).toEqual([
      { schema: "ASAOLIB", name: "M_MENU", alias: "T1" }
    ]);
  });

  it("結合した表を順に拾う（利用者の SQL）", () => {
    const refs = tableRefsOf(
      "SELECT * FROM ASAOLIB.M_MENUTR T1\nINNER JOIN ASAOLIB.M_MENU T2\nON T2.MENUCD = T1.CMENUCD"
    );
    expect(refs).toEqual([
      { schema: "ASAOLIB", name: "M_MENUTR", alias: "T1" },
      { schema: "ASAOLIB", name: "M_MENU", alias: "T2" }
    ]);
  });

  /** `FROM T WHERE …` の `WHERE` を別名にすると、そこから先が全部おかしくなる */
  it("**予約語は別名にしない**", () => {
    expect(tableRefsOf("SELECT * FROM M_MENU WHERE X = 1")).toEqual([{ name: "M_MENU" }]);
    expect(tableRefsOf("SELECT * FROM A JOIN B ON A.X = B.X")).toEqual([
      { name: "A" },
      { name: "B" }
    ]);
  });

  it("ライブラリーが無い表も拾う", () => {
    expect(tableRefsOf("SELECT * FROM M_MENU M")).toEqual([{ name: "M_MENU", alias: "M" }]);
  });

  it("小文字で書いても大文字に揃える（SQL の名前解決に合わせる）", () => {
    expect(tableRefsOf("select * from asaolib.m_menu t1")).toEqual([
      { schema: "ASAOLIB", name: "M_MENU", alias: "T1" }
    ]);
  });

  it("引用符つきの名前は**大文字にしない**", () => {
    expect(tableRefsOf('SELECT * FROM "mixedCase"')).toEqual([{ name: "mixedCase" }]);
  });

  it("UPDATE / INSERT INTO も見る", () => {
    expect(tableRefsOf("UPDATE ASAOLIB.M_MENU SET X = 1")).toEqual([
      { schema: "ASAOLIB", name: "M_MENU" }
    ]);
    expect(tableRefsOf("INSERT INTO ASAOLIB.M_MENU VALUES (1)")).toEqual([
      { schema: "ASAOLIB", name: "M_MENU" }
    ]);
  });
});

describe("キャレット直前の `修飾子.`", () => {
  const q = (text: string) => qualifierAt(text, text.length);

  it("`.` の直後を拾う", () => {
    expect(q("SELECT T1.")).toMatchObject({ qualifier: "T1", prefix: "" });
  });

  it("打ちかけの文字も拾う（絞り込みに使う）", () => {
    const r = q("SELECT T1.MEN");
    expect(r).toMatchObject({ qualifier: "T1", prefix: "MEN" });
    // 置き換えるのは `.` の後ろだけ
    expect("SELECT T1.MEN".slice(r!.from, r!.to)).toBe("MEN");
  });

  it("`.` が無ければ出さない", () => {
    expect(q("SELECT T1")).toBeUndefined();
  });

  it("空白をまたいでも拾う（`T1 . X`）", () => {
    expect(q("SELECT T1 . ")).toMatchObject({ qualifier: "T1" });
  });

  it("小数点は修飾子にならない（前が数字）", () => {
    expect(q("SELECT 1.5")).toBeUndefined();
  });
});

describe("修飾子から表を解く", () => {
  const refs = tableRefsOf(
    "SELECT * FROM ASAOLIB.M_MENUTR T1 INNER JOIN ASAOLIB.M_MENU T2 ON T2.MENUCD = T1.CMENUCD"
  );

  it("別名で解ける", () => {
    expect(resolveQualifier(refs, "T2")).toEqual({ schema: "ASAOLIB", name: "M_MENU", alias: "T2" });
  });

  it("表名でも解ける（別名を付けていないとき）", () => {
    expect(resolveQualifier(tableRefsOf("SELECT * FROM ASAOLIB.M_MENU"), "M_MENU")).toEqual({
      schema: "ASAOLIB",
      name: "M_MENU"
    });
  });

  it("大文字小文字は問わない", () => {
    expect(resolveQualifier(refs, "t1")?.name).toBe("M_MENUTR");
  });

  /** 別名が別の表と同じ名前でも、書いた人の意図は別名の方 */
  it("**別名を表名より先に見る**", () => {
    const tricky = tableRefsOf("SELECT * FROM ASAOLIB.M_MENU M_MENUTR, ASAOLIB.M_MENUTR");
    expect(resolveQualifier(tricky, "M_MENUTR")?.name).toBe("M_MENU");
  });

  it("知らない修飾子は解けない（候補を出さない）", () => {
    expect(resolveQualifier(refs, "ZZ")).toBeUndefined();
  });
});
