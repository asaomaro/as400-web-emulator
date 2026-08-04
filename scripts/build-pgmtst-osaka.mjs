/**
 * **プログラム呼び出しの検証用 CL プログラム**を実機に作る（冪等）。
 *
 *   node --env-file=.env scripts/build-pgmtst-osaka.mjs
 *
 * `ASAOLIB/PGMTST` は**参照渡しの引数を書き換える**だけの小さなプログラム:
 *
 * ```
 * PGM PARM(&NUM &TXT)
 *   &NUM = &NUM * 2        （詰め 10 進 15,5）
 *   &TXT = 'ECHO:' + &TXT  （文字 20）
 * ```
 *
 * ## なぜ CL なのか
 *
 * **CL の `PARM` は参照渡し**なので、1 つの引数で inout をそのまま試せる。
 * RPG だと DDS もコンパイルも要るが、CL は `CRTCLPGM` だけで済む。
 * `TYPE(*DEC) LEN(15 5)` は**詰め 10 進 8 バイト**で、`QCMDEXC` の長さ引数と同じ形。
 *
 * ソースは**SQL の INSERT で流し込む**（`build-attrtest.mjs` と同じ手口。
 * IFS も FTP も要らない）。
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { executeStatement } from "@ts5250/hostserver";
import { ConfigResolver, ServerConfigStore, PersonalConfigStore, openCommand, openDb } from "@ts5250/server";

const LIB = process.env.AS400_LIB ?? "ASAOLIB";
const SRCF = "QCLSRC";
const MBR = "PGMTST";
const TMP = "/tmp/ts5250-pgmtst";
mkdirSync(TMP, { recursive: true });
const log = (s) => process.stdout.write(s + "\n");

const cfg = JSON.parse(readFileSync("connections.json", "utf8"));
const sys = cfg.systems.find((s) => s.name === "SR-OSAKA");
sys.signon = { user: sys.signon.user, passwordEnv: "AS400_PASSWORD" };
cfg.sessions = [];
writeFileSync(`${TMP}/cfg.json`, JSON.stringify(cfg));
const resolver = new ConfigResolver(
  ServerConfigStore.fromFile(`${TMP}/cfg.json`),
  new PersonalConfigStore({ systems: [], sessions: [] })
);
const connect = resolver.resolve({ system: `srv:${sys.id}` }, undefined, () => undefined).connect;

/** ソース 1 行ぶん（CL は桁位置に厳しくないが、先頭に空白を置く慣習に合わせる） */
const SOURCE = [
  "PGM PARM(&NUM &TXT)",
  "DCL VAR(&NUM) TYPE(*DEC) LEN(15 5)",
  "DCL VAR(&TXT) TYPE(*CHAR) LEN(20)",
  "CHGVAR VAR(&NUM) VALUE(&NUM * 2)",
  "CHGVAR VAR(&TXT) VALUE('ECHO:' *CAT &TXT)",
  "ENDPGM"
];

const cmd = await openCommand(connect);
const db = await openDb(connect);
try {
  // **冪等**——作り直せるように、あるものは消してから作る
  for (const c of [
    `DLTPGM PGM(${LIB}/${MBR})`,
    `RMVM FILE(${LIB}/${SRCF}) MBR(${MBR})`
  ]) {
    const r = await cmd.run(c);
    log(`${c.padEnd(44)} → ${r.success ? "消した" : (r.messages[0]?.id ?? "無かった")}`);
  }

  const add = await cmd.run(`ADDPFM FILE(${LIB}/${SRCF}) MBR(${MBR}) SRCTYPE(CLP)`);
  log(`ADDPFM ${MBR}`.padEnd(44) + ` → ${add.success ? "OK" : add.messages[0]?.id}`);
  if (!add.success) throw new Error("メンバーを作れませんでした");

  // ソースを SQL で流し込む。**1 行 = 1 リテラル**（連結 `||` は変体文字の問題で使わない）。
  // **別名でメンバーを指す**——SQL からソース物理ファイルの特定メンバーへ書くには別名が要る
  const alias = `${MBR}A`;
  await executeStatement(db, `DROP ALIAS ${LIB}.${alias}`).catch(() => undefined);
  await executeStatement(db, `CREATE ALIAS ${LIB}.${alias} FOR ${LIB}.${SRCF} (${MBR})`);
  for (const [i, line] of SOURCE.entries()) {
    const seq = (i + 1) * 100;
    await executeStatement(
      db,
      `INSERT INTO ${LIB}.${alias} (SRCSEQ, SRCDAT, SRCDTA) VALUES (${seq}, 0, '${line.replace(/'/gu, "''")}')`
    );
  }
  await executeStatement(db, `DROP ALIAS ${LIB}.${alias}`).catch(() => undefined);
  log(`ソース ${SOURCE.length} 行を投入`);

  const crt = await cmd.run(`CRTCLPGM PGM(${LIB}/${MBR}) SRCFILE(${LIB}/${SRCF}) SRCMBR(${MBR})`);
  log(`CRTCLPGM ${MBR}`.padEnd(44) + ` → ${crt.success ? "OK" : crt.messages.map((m) => `${m.id} ${m.text}`).join(" / ")}`);
  if (!crt.success) throw new Error("コンパイルに失敗しました");
  log(`\n${LIB}/${MBR} を作りました`);
} finally {
  cmd.close();
  db.close();
}
