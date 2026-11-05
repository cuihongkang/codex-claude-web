import assert from "node:assert/strict";
import test from "node:test";
import { createMessageEditing } from "../src/application/message-editing.js";

function fixture(respond) {
  const item = {
    id: "user",
    turnId: "last",
    type: "userMessage",
    content: [{ type: "text", text: "原消息" }],
  };
  let state = {
    connected: true,
    current: { id: "thread" },
    active: {},
    items: [item],
    turns: {},
    turnTimings: { thread: { first: {}, last: {} } },
    turnDiffs: { thread: { first: "keep", last: "remove" } },
    diffs: {},
    plans: {},
  };
  const requests = [];
  const navigation = {
    opening: 1,
    invalidations: 0,
    invalidateHistory() {
      this.invalidations++;
    },
  };
  const edit = { threadId: "thread", item };
  const controller = createMessageEditing({
    get: () => state,
    set: (patch) => {
      state = { ...state, ...patch };
    },
    rpc: async (method, params) => {
      requests.push({ method, params });
      return respond(method, params, item);
    },
    navigation,
  });
  return {
    controller,
    edit,
    requests,
    navigation,
    get: () => state,
    patch: (patch) => {
      state = { ...state, ...patch };
    },
  };
}

test("编辑回退读取完整分页，旧接口仅在明确不支持时使用，重试保留先前历史", async () => {
  let reverted = false;
  const f = fixture((method, params, item) => {
    if (method === "thread/turns/list") {
      if (reverted)
        return { data: [{ id: "first", items: [] }], nextCursor: null };
      return params.cursor
        ? {
            data: [
              { id: "last", items: [item] },
              { id: "auto", items: [] },
            ],
            nextCursor: null,
          }
        : { data: [{ id: "first", items: [] }], nextCursor: "next" };
    }
    if (method === "thread/revert") throw new Error("Unknown method");
    if (method === "thread/rollback") {
      reverted = true;
      return { thread: {} };
    }
    throw new Error(method);
  });
  await f.controller.prepare(f.edit);
  assert.deepEqual(f.requests.at(-1), {
    method: "thread/rollback",
    params: { threadId: "thread", numTurns: 2 },
  });
  assert.deepEqual(f.get().turnDiffs.thread, { first: "keep" });
  assert.equal(f.get().items.at(-1).id, "user");
  await f.controller.prepare(f.edit);
  assert.equal(
    f.requests.filter((request) => request.method === "thread/rollback").length,
    1,
  );
  f.controller.finish(f.edit);
  assert.equal(f.get().items.length, 0);
});

test("回退失败保留原记录，普通错误保持实际原因", async () => {
  const f = fixture((method, params, item) => {
    if (method === "thread/turns/list")
      return { data: [{ id: "last", items: [item] }], nextCursor: null };
    throw new Error("磁盘写入失败");
  });
  await assert.rejects(f.controller.prepare(f.edit), /磁盘写入失败/);
  assert.equal(f.get().items[0], f.edit.item);
  assert.equal(
    f.requests.some((request) => request.method === "thread/rollback"),
    false,
  );
});

test("其他客户端新增消息后拒绝过期编辑和回退后的重复重发", async () => {
  const f = fixture((method, params, item) => ({
    data: [{ id: "last", items: [item, { id: "new", type: "userMessage" }] }],
    nextCursor: null,
  }));
  await assert.rejects(f.controller.prepare(f.edit), /最近一轮/);
  f.edit.retainedIds = "[]";
  await assert.rejects(f.controller.prepare(f.edit), /已有新消息/);
  assert.equal(
    f.requests.every((request) => request.method === "thread/turns/list"),
    true,
  );
});

test("读取或回退期间切换对话，迟到结果保留新对话状态", async () => {
  let resolve;
  const f = fixture((method, params, item) => {
    if (method === "thread/turns/list")
      return { data: [{ id: "last", items: [item] }], nextCursor: null };
    return new Promise((done) => {
      resolve = done;
    });
  });
  const pending = f.controller.prepare(f.edit);
  await new Promise((done) => setImmediate(done));
  f.patch({ current: { id: "other" }, items: [{ id: "other-item" }] });
  f.navigation.opening++;
  resolve({ thread: {} });
  await assert.rejects(pending, /返回原对话/);
  assert.deepEqual(f.get().items, [{ id: "other-item" }]);
  assert.equal(f.edit.retainedIds, "[]");
});

test("活动轮次阻止编辑，完整读取中的运行状态同样生效", async () => {
  const f = fixture((method, params, item) => ({
    data: [{ id: "last", status: "inProgress", items: [item] }],
    nextCursor: null,
  }));
  f.patch({ active: { thread: "last" } });
  await assert.rejects(f.controller.prepare(f.edit), /当前任务结束/);
  assert.equal(f.requests.length, 0);
  f.patch({ active: {} });
  await assert.rejects(f.controller.prepare(f.edit), /当前任务结束/);
  assert.equal(f.requests.length, 1);
});
