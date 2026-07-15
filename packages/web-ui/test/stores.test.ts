import { describe, it, expect, beforeEach } from "vitest";
import { workspaceStore } from "../src/stores/workspace.js";
import { logStore, maskOutgoing } from "../src/stores/log.js";
import { settingsStore } from "../src/stores/settings.js";

describe("workspaceStore 分割ツリー", () => {
  beforeEach(() => workspaceStore.init());

  it("セッションをフォーカスグループのタブとして追加する", () => {
    workspaceStore.addSession("s1");
    workspaceStore.addSession("s2");
    const g = workspaceStore.focusedGroup();
    expect(g.tabs).toEqual(["s1", "s2"]);
    expect(g.activeTab).toBe("s2");
    expect(workspaceStore.groups()).toHaveLength(1);
  });

  it("split で分割ツリーになり新グループにフォーカスが移る", () => {
    workspaceStore.addSession("s1");
    workspaceStore.addSession("s2");
    const g = workspaceStore.focusedGroup();
    workspaceStore.split(g.id, "right", "s2");
    expect(workspaceStore.root.type).toBe("split");
    expect(workspaceStore.groups()).toHaveLength(2);
    // s2 は新グループ、s1 は元グループ
    const groups = workspaceStore.groups();
    expect(groups.some((x) => x.tabs.includes("s1") && !x.tabs.includes("s2"))).toBe(true);
    expect(groups.some((x) => x.tabs.includes("s2") && !x.tabs.includes("s1"))).toBe(true);
  });

  it("moveTab でタブが別グループへ移り、空グループは片付く", () => {
    workspaceStore.addSession("s1");
    workspaceStore.addSession("s2");
    const g0 = workspaceStore.focusedGroup();
    workspaceStore.split(g0.id, "right", "s2"); // s1|s2 の 2 グループ
    const [a, b] = workspaceStore.groups();
    workspaceStore.moveTab("s1", b!.id); // s1 を b に移す → a が空 → 片付け
    expect(workspaceStore.groups()).toHaveLength(1);
    expect(workspaceStore.groups()[0]!.tabs.sort()).toEqual(["s1", "s2"]);
  });

  it("closeSession で全部閉じると単一空グループに戻る", () => {
    workspaceStore.addSession("s1");
    workspaceStore.closeSession("s1");
    expect(workspaceStore.groups()).toHaveLength(1);
    expect(workspaceStore.groups()[0]!.tabs).toEqual([]);
  });

  it("narrow 時は split が合流にフォールバックする", () => {
    workspaceStore.addSession("s1");
    workspaceStore.addSession("s2");
    workspaceStore.narrow = true;
    workspaceStore.split(workspaceStore.focusedGroup().id, "right", "s2");
    expect(workspaceStore.root.type).toBe("group"); // 分割されない
    workspaceStore.narrow = false;
  });
});

describe("logStore", () => {
  beforeEach(() => logStore.clear());

  it("エントリを追加し 500 件でリングバッファになる", () => {
    for (let i = 0; i < 520; i++) logStore.add({ ts: i, sessionId: "s", dir: "tx", kind: "key", summary: "" });
    expect(logStore.entries.length).toBe(500);
    expect(logStore.entries[0]!.ts).toBe(20); // 先頭 20 件が押し出された
  });

  it("JSONL 出力できる", () => {
    logStore.add({ ts: 1, sessionId: "s", dir: "rx", kind: "screen", summary: "24x80" });
    expect(logStore.toJsonl()).toContain('"kind":"screen"');
  });
});

describe("maskOutgoing", () => {
  it("hidden フィールドの値を伏字化する", () => {
    const msg = { type: "key", key: "Enter", fields: [{ field: 1, value: "USER" }, { field: 2, value: "SECRET" }] };
    const masked = maskOutgoing(msg, new Set([2])) as typeof msg;
    expect(masked.fields[0]!.value).toBe("USER");
    expect(masked.fields[1]!.value).toBe("●●●●");
  });
});

describe("settingsStore", () => {
  beforeEach(() => {
    settingsStore.connections.splice(0, settingsStore.connections.length);
    if (typeof localStorage !== "undefined") localStorage.clear();
  });

  it("接続設定を保存・更新・削除できる（認証情報なし）", () => {
    const c = settingsStore.save({ name: "dev", host: "192.168.0.5", port: 23 });
    expect(c.id).toBeTruthy();
    expect(JSON.stringify(c)).not.toContain("password");
    settingsStore.save({ id: c.id, name: "dev2", host: "192.168.0.5" });
    expect(settingsStore.connections[0]!.name).toBe("dev2");
    settingsStore.remove(c.id);
    expect(settingsStore.connections).toHaveLength(0);
  });
});
