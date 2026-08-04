/**
 * **サービスプログラムの手続き呼び出し。**
 *
 * ## 新しい電文は要らない
 *
 * IBM i は `QSYS/QZRUCLSP` という**普通のプログラム**を提供していて、
 * そこへ「どのサービスプログラムの、どの手続きを、どんな引数で」を渡すと
 * 呼んでくれる。つまり**既存のプログラム呼び出しの上に載る**。
 *
 * ## 引数の配置（実機で確かめた・2026-08-04）
 *
 * ```
 * 0  修飾名        char(20)  サービスプログラム名(10) ＋ ライブラリー(10)
 * 1  手続き名      char(*)   EBCDIC ＋ ヌル終端
 * 2  戻り値の形式  bin(4)    0=無し / 1=整数
 * 3  引数の形式    bin(4)[n] **1=値渡し / 2=参照渡し**
 * 4  引数の数      bin(4)
 * 5  エラーコード  char(4)   ゼロ（＝例外をメッセージで返す）
 * 6  戻り値        char(4)   **戻り値が無くても必ず渡す**
 * 7- 実引数
 * ```
 *
 * **値渡しが 1、参照渡しが 2**——逆に書くと呼べてしまうが**戻り値が 0 になる**（実機で観測）。
 * 失敗しないので気づきにくい。
 *
 * **戻り値の器は戻り値が無くても渡す**——省くと `MCH3601`（ポインタ不正）になる。
 */
import { codecForCcsid } from "@ts5250/ebcdic";
import type { CommandResult } from "./command-connection.js";
import type { ProgramParameter } from "./command-datastream.js";

/** 引数の渡し方。**既定は参照渡し**（IBM i の慣習） */
export type PassBy = "reference" | "value";

/** `QZRUCLSP` が使う番号。**取り違えると戻り値が 0 になるだけで失敗しない** */
const PASS_CODE: Record<PassBy, number> = { value: 1, reference: 2 };

/** 戻り値の形式 */
export type ReturnKind = "none" | "int";
const RETURN_CODE: Record<ReturnKind, number> = { none: 0, int: 1 };

/** `QZRUCLSP` を呼ぶための引数（`ProgramParameter` へ変換済みの実引数を受け取る） */
export interface ServiceProgramCallSpec {
  serviceProgram: string;
  library: string;
  procedure: string;
  /** 戻り値の形式。既定は `none` */
  returns?: ReturnKind;
  /** 実引数。`pass` の既定は `reference` */
  args: readonly { param: ProgramParameter; pass?: PassBy }[];
  /** 手続き名と修飾名の符号化に使う CCSID */
  ccsid: number;
}

const bin4 = (v: number): Uint8Array => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setInt32(0, v);
  return b;
};

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/** 10 桁へ空白詰め（EBCDIC） */
function padded10(text: string, ccsid: number): Uint8Array {
  const codec = codecForCcsid(ccsid);
  const blank = codec.encode(" ").bytes[0] ?? 0x40;
  const out = new Uint8Array(10).fill(blank);
  out.set(codec.encode(text.toUpperCase()).bytes.slice(0, 10));
  return out;
}

/** `QZRUCLSP` へ渡すパラメータ列を組む */
export function buildServiceProgramParams(spec: ServiceProgramCallSpec): ProgramParameter[] {
  const codec = codecForCcsid(spec.ccsid);
  const formats = spec.args.map((a) => bin4(PASS_CODE[a.pass ?? "reference"]));
  return [
    { type: "in", data: concat([padded10(spec.serviceProgram, spec.ccsid), padded10(spec.library, spec.ccsid)]) },
    // **ヌル終端**（手続き名は C の文字列として読まれる）
    { type: "in", data: concat([codec.encode(spec.procedure).bytes, Uint8Array.of(0)]) },
    { type: "in", data: bin4(RETURN_CODE[spec.returns ?? "none"]) },
    // 引数が 0 個でも**空ではなく 4 バイト**を渡す（ヌルポインタにしない）
    { type: "in", data: formats.length > 0 ? concat(formats) : bin4(0) },
    { type: "in", data: bin4(spec.args.length) },
    // エラーコード。**ゼロ = 例外をメッセージで返す**
    { type: "inout", data: new Uint8Array(4), length: 4 },
    // **戻り値の器は戻り値が無くても渡す**（省くと MCH3601）
    { type: "out", length: 4 },
    ...spec.args.map((a) => a.param)
  ];
}

/** `QZRUCLSP` の応答から、実引数の出力と戻り値を切り出す */
export function splitServiceProgramOutputs(
  outputs: readonly (Uint8Array | undefined)[],
  argCount: number
): { returnValue: number | undefined; args: (Uint8Array | undefined)[] } {
  const rv = outputs[6];
  return {
    returnValue: rv && rv.length >= 4 ? new DataView(rv.buffer, rv.byteOffset, 4).getInt32(0) : undefined,
    args: outputs.slice(7, 7 + argCount)
  };
}

/** 呼び出しの結果 */
export interface ServiceProgramResult {
  result: CommandResult;
  /** `returns: "int"` のときの戻り値 */
  returnValue: number | undefined;
  /** 実引数の出力（要求順。出力でない位置は `undefined`） */
  args: (Uint8Array | undefined)[];
}
