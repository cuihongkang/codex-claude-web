import test from "node:test";
import assert from "node:assert/strict";
import { createConnection } from "../src/application/connection.js";

test("后端启停立即刷新对话列表，并关闭已停用后端的当前对话", async (t) => {
  const original = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: () => null,
    setItem() {},
    removeItem() {},
  };
  t.after(() => {
    globalThis.localStorage = original;
  });
  const backends = (enabled) => [
    {
      id: "codex",
      ready: enabled.includes("codex"),
      enabled: enabled.includes("codex"),
    },
    {
      id: "claude",
      ready: enabled.includes("claude"),
      enabled: enabled.includes("claude"),
    },
  ];
  let state = {
    connected: true,
    backendId: "claude",
    backends: backends(["codex", "claude"]),
    current: { id: "backend:claude:thread" },
    model: "sonnet",
    effort: "high",
    serviceTier: "fast",
    questions: [],
    undoneFiles: {},
    compactions: {},
    cwd: "/demo",
    draft: "保留草稿",
    items: [{ id: "saved" }],
    usage: null,
    loading: false,
  };
  const calls = [];
  const connection = createConnection({
    get: () => state,
    set: (patch) => {
      state = { ...state, ...patch };
    },
    rpc() {
      throw new Error("测试中不读取后端目录");
    },
    transport: {},
    models: {},
    records: {},
    navigation: {
      opening: 0,
      newChat(cwd, options) {
        calls.push(["newChat", cwd, options]);
        state = { ...state, current: null, items: [] };
      },
    },
    catalog: { loadThreads: async () => calls.push(["list"]) },
    messages: {},
    account: { revision: 0, reset: () => calls.push(["reset"]) },
    compaction: {},
    events: {},
    emit() {},
    report(error) {
      throw error;
    },
    loadSkills: async () => {},
    activateBackend: async (id) => calls.push(["activate", id]),
  });
  const snapshot = (enabled) =>
    connection.onNotification({
      method: "lan/state",
      params: {
        ready: true,
        bridgeReady: true,
        backends: backends(enabled),
        defaultBackendId: enabled.includes("codex") ? "codex" : "claude",
        questions: [],
        activeTurns: {},
        compactions: {},
      },
    });
  snapshot(["codex"]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, [
    ["reset"],
    ["newChat", undefined, { applyModelSelection: false }],
    ["activate", "codex"],
    ["list"],
  ]);
  assert.equal(state.backendId, "codex");
  assert.equal(state.model, "");
  assert.equal(state.effort, "");
  assert.equal(state.serviceTier, null);
  assert.equal(state.current, null);

  calls.length = 0;
  snapshot(["codex", "claude"]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, [["list"]]);

  state = { ...state, backendId: "codex", current: { id: "codex-thread" } };
  calls.length = 0;
  snapshot(["codex"]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, [["list"]]);
  assert.equal(state.current.id, "codex-thread");

  snapshot(["codex", "claude"]);
  state = {
    ...state,
    threadAccess: { threadId: "backend:claude:opening", status: "loading" },
  };
  calls.length = 0;
  snapshot(["codex"]);
  assert.equal(
    calls.some(([name]) => name === "newChat"),
    true,
  );
});

test("启停快照同步过滤已有列表，迟到结果和实时插入继续遵守启用范围", async (t) => {
  const previous = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  t.after(() => {
    globalThis.localStorage = previous;
  });
  const { createAppState } = await import("../src/application/state.js");
  const store = createAppState();
  const threads = [{ id: "codex-thread" }, { id: "backend:claude:thread" }];
  const choices = [
    { backendId: "codex", model: "gpt" },
    { backendId: "claude", model: "sonnet" },
  ];
  const directory = (codex, claude) => [
    { id: "codex", enabled: codex },
    { id: "claude", enabled: claude },
  ];
  store.set({
    backends: directory(true, true),
    threads,
    modelChoices: choices,
    draft: "保留草稿",
  });
  for (const [codex, claude, expected] of [
    [true, false, [threads[0]]],
    [false, true, [threads[1]]],
    [false, false, []],
  ]) {
    store.set({
      backends: directory(codex, claude),
      threads,
      modelChoices: choices,
    });
    assert.deepEqual(store.get().threads, expected);
    store.set({ threads: [...threads], modelChoices: choices });
    assert.deepEqual(store.sharedSnapshot().threads, expected);
    assert.deepEqual(
      store.get().modelChoices.map((choice) => choice.backendId),
      expected.map((thread) =>
        thread.id.startsWith("backend:") ? "claude" : "codex",
      ),
    );
    assert.equal(store.get().draft, "保留草稿");
  }
  store.set({ backends: directory(true, true), threads });
  assert.deepEqual(store.get().threads, threads);
});
