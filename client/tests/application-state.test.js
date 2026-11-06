import test from "node:test";
import assert from "node:assert/strict";
import { createAppState } from "../src/application/state.js";

test("状态实例相互隔离，草稿只通知草稿订阅者，取消订阅后停止通知", (t) => {
  const previous = globalThis.localStorage;
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  t.after(() => {
    globalThis.localStorage = previous;
  });
  const first = createAppState(),
    second = createAppState();
  const shared = first.sharedSnapshot();
  let sharedUpdates = 0,
    draftUpdates = 0;
  const unsubscribe = first.subscribe(() => sharedUpdates++);
  const unsubscribeDraft = first.subscribeDraft(() => draftUpdates++);
  first.set({ draft: "正在输入" });
  first.set({ draft: "正在输入" });
  assert.equal(first.sharedSnapshot(), shared);
  assert.equal(sharedUpdates, 0);
  assert.equal(draftUpdates, 1);
  assert.equal(second.get().draft, "");
  first.set({ draft: "下一条", current: { id: "thread-a" } });
  assert.equal(sharedUpdates, 1);
  assert.equal(draftUpdates, 2);
  assert.equal(second.get().current, null);
  unsubscribe();
  unsubscribeDraft();
  first.set({ draft: "已取消监听", current: null });
  assert.equal(sharedUpdates, 1);
  assert.equal(draftUpdates, 2);
});

test("状态入口统一清理详情选择、运行轮次未读标记并只保存未结束整理", (t) => {
  const previous = globalThis.localStorage;
  const storage = new Map();
  globalThis.localStorage = {
    getItem: () => null,
    setItem: (key, value) => storage.set(key, value),
  };
  t.after(() => {
    globalThis.localStorage = previous;
  });
  const state = createAppState();
  state.set({
    panel: "agent",
    panelAgent: { id: "agent" },
    unreadCompletions: { a: "old", b: "unread" },
  });
  assert.equal(state.get().contextOpen, true);
  state.set({
    contextOpen: false,
    active: { a: "new" },
    compactions: { a: { status: "running" }, b: { status: "completed" } },
  });
  assert.equal(state.get().panel, null);
  assert.equal(state.get().panelAgent, null);
  assert.deepEqual(state.get().unreadCompletions, { b: "unread" });
  assert.deepEqual(JSON.parse(storage.get("cx-compactions")), {
    a: { status: "running" },
  });
  state.set({ current: { id: "a" } });
  state.set({ current: { id: "b" } });
  assert.equal(
    state.get().compactions.a.status,
    "running",
    "切换保留进行中的整理",
  );
  state.set({ current: { id: "b", name: "重命名" } });
  assert.equal(
    state.get().compactions.b.status,
    "completed",
    "相同对话保留提示",
  );
  state.set({ current: null });
  assert.equal(state.get().compactions.b, undefined, "离开对话收起完成提示");
  assert.equal(state.get().compactions.a.status, "running");
});

test("计划模式按对话保存并在新实例恢复，迟到结果只更新原对话", (t) => {
  const previous = globalThis.localStorage;
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  t.after(() => {
    globalThis.localStorage = previous;
  });
  const state = createAppState();
  state.set({ mode: "plan" });
  state.set({ current: { id: "created" }, mode: state.get().mode });
  assert.equal(state.get().mode, "plan");
  state.set({ current: { id: "other" } });
  assert.equal(state.get().mode, "default");
  state.set({ mode: "plan" });
  state.setThreadMode("created", "default");
  assert.equal(state.get().mode, "plan");
  const restored = createAppState();
  restored.set({ current: { id: "created" } });
  assert.equal(restored.get().mode, "default");
  restored.set({ current: { id: "other" } });
  assert.equal(restored.get().mode, "plan");
  restored.set({ current: null });
  assert.equal(restored.get().mode, "default");
});
