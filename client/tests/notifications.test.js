import test from "node:test";
import assert from "node:assert/strict";
import { createNotifications } from "../src/application/notifications.js";
import { createEvents } from "../src/application/events.js";

function fixture() {
  let state = {
    auth: { authenticated: true, username: "demo" },
    connected: true,
    booting: false,
    threads: [
      { id: "a", name: "核对构建" },
      { id: "b", name: "检查界面" },
    ],
    current: null,
    active: {},
    compactions: {},
    turns: {},
    turnTimings: {},
  };
  let status = { supported: true, enabled: false, permission: "default" };
  const sent = [];
  const opened = [];
  const subscribers = new Set();
  let callbacks;
  let unlistened = false;
  const get = () => state;
  const set = (patch) => {
    state = { ...state, ...patch };
    for (const listener of subscribers) listener();
  };
  const browser = {
    status: () => ({ ...status }),
    enable: async () => {
      status = { ...status, enabled: true, permission: "granted" };
    },
    disable: () => {
      status.enabled = false;
    },
    show: async (notification) => {
      if (notification.current()) sent.push(notification);
    },
    listen: (listeners) => {
      callbacks = listeners;
      return () => {
        unlistened = true;
      };
    },
  };
  const notifications = createNotifications({
    get,
    set,
    subscribe: (listener) => {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    navigation: { openThread: (id) => opened.push(id) },
    browser,
  });
  return {
    get,
    set,
    browser,
    notifications,
    sent,
    opened,
    subscribers,
    updateStatus: (patch) => Object.assign(status, patch),
    get callbacks() {
      return callbacks;
    },
    get unlistened() {
      return unlistened;
    },
  };
}

test("通知由主动开启控制，成功轮次携带标题、所属对话及唯一去重键", async () => {
  const f = fixture();
  const turn = { id: "one", status: "completed" };
  await f.notifications.completed("a", turn);
  assert.equal(f.sent.length, 0);
  await f.notifications.setEnabled(true);
  await f.notifications.completed("a", { ...turn, status: "failed" });
  await f.notifications.completed("a", { ...turn, status: "interrupted" });
  assert.equal(f.sent.length, 0);
  await f.notifications.completed("a", turn);
  await f.notifications.completed("b", turn);
  assert.deepEqual(
    f.sent.map((n) => [n.title, n.threadId, n.key]),
    [
      ["核对构建", "a", JSON.stringify(["demo", "a", "one"])],
      ["检查界面", "b", JSON.stringify(["demo", "b", "one"])],
    ],
  );
  await f.notifications.setEnabled(false);
  assert.equal(f.sent[0].current(), false, "关闭使异步发送失效");
  await f.notifications.completed("a", { ...turn, id: "two" });
  assert.equal(f.sent.length, 2);
});

test("通知权限、存储和展示错误留在设置状态中，登出隔离迟到操作", async () => {
  const f = fixture();
  f.browser.enable = async () => {
    throw new Error("授权失败");
  };
  await f.notifications.setEnabled(true);
  assert.equal(f.get().notifications.error, "授权失败");
  f.updateStatus({ enabled: true, permission: "denied" });
  await f.notifications.completed("a", { id: "one", status: "completed" });
  assert.equal(f.sent.length, 0);
  assert.equal(f.get().notifications.permission, "denied");
  f.updateStatus({ permission: "granted" });
  f.browser.show = async () => {
    throw new Error("存储不可用");
  };
  await f.notifications.completed("a", { id: "two", status: "completed" });
  assert.equal(f.get().notifications.error, "存储不可用");
  f.browser.show = async (notification) => {
    f.set({ auth: { authenticated: false } });
    assert.equal(notification.current(), false);
    throw new Error("旧请求失败");
  };
  await f.notifications.completed("a", { id: "three", status: "completed" });
  assert.equal(f.get().notifications.error, "存储不可用");
});

test("权限变化早于授权完成时仍同步开关；点击等待初始化并清理生命周期", async () => {
  const f = fixture();
  const cleanup = f.notifications.start();
  f.browser.enable = async () => {
    f.updateStatus({ permission: "granted" });
    f.callbacks.refresh();
    f.updateStatus({ enabled: true });
  };
  await f.notifications.setEnabled(true);
  assert.equal(f.get().notifications.enabled, true);
  f.set({ connected: false, booting: true });
  f.callbacks.open({ threadId: "b", username: "demo" });
  assert.deepEqual(f.opened, []);
  f.set({ connected: true, booting: false });
  await Promise.resolve();
  assert.deepEqual(f.opened, ["b"]);
  f.callbacks.open({ threadId: "a", username: "other" });
  await Promise.resolve();
  assert.deepEqual(f.opened, ["b"]);
  f.set({ auth: null });
  f.callbacks.open({ threadId: "a", username: "demo" });
  f.set({ auth: { authenticated: true, username: "demo" } });
  await Promise.resolve();
  assert.deepEqual(f.opened, ["b", "a"]);
  cleanup();
  assert.equal(f.subscribers.size, 0);
  assert.equal(f.unlistened, true);
});

test("搜索列表外的完成任务通过只读接口读取真实标题", async () => {
  const f = fixture();
  const sent = [];
  const notifications = createNotifications({
    get: f.get,
    set: f.set,
    browser: {
      ...f.browser,
      status: () => ({ supported: true, enabled: true, permission: "granted" }),
      show: async (notification) => sent.push(notification),
    },
    rpc: async (method, params) => {
      assert.equal(method, "thread/read");
      assert.deepEqual(params, { threadId: "hidden", includeTurns: false });
      return { thread: { id: "hidden", name: "搜索结果以外的任务" } };
    },
  });
  await notifications.completed("hidden", { id: "turn", status: "completed" });
  assert.equal(sent[0].title, "搜索结果以外的任务");
});

test("只有实际活动轮次完成触发通知，历史、重复完成与手动整理保持安静", async () => {
  const f = fixture();
  const calls = [];
  const events = createEvents({
    get: f.get,
    set: f.set,
    records: {
      turnRevisions: new Map(),
      recordTurnTimings() {},
      recordThreadActivity() {},
    },
    catalog: { loadThreads: async () => {} },
    account: { refreshUsage() {} },
    notifications: { completed: (...args) => calls.push(args) },
  });
  const completed = (id) =>
    events.handle({
      method: "turn/completed",
      params: { threadId: "a", turn: { id, status: "completed" } },
    });
  completed("historical");
  assert.equal(calls.length, 0);
  events.handle({
    method: "turn/started",
    params: { threadId: "a", turn: { id: "live" } },
  });
  completed("live");
  completed("live");
  assert.equal(calls.length, 1);
  f.set({
    active: { a: "compact" },
    compactions: { a: { turnId: "compact", status: "running" } },
  });
  completed("compact");
  assert.equal(calls.length, 1);
});
