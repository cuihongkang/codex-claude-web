import test from "node:test";
import assert from "node:assert/strict";
import { readThreadHistory } from "../src/domain/thread-history.js";

test("消息接口不支持时按完整轮次分页恢复消息与轮内顺序", async () => {
  for (const sortDirection of ["asc", "desc"]) {
    const turns = Array.from({ length: 101 }, (_, index) => ({
      id: `turn-${index}`,
      items: [
        { id: `user-${index}`, type: "userMessage" },
        { id: `answer-${index}`, type: "agentMessage" },
      ],
    }));
    const ordered = sortDirection === "desc" ? turns.toReversed() : turns;
    const calls = [];
    const items = await readThreadHistory(
      async (method, params) => {
        calls.push({ method, params });
        if (method === "thread/items/list")
          throw new Error("thread/items/list is not supported yet");
        assert.equal(method, "thread/turns/list");
        assert.equal(params.itemsView, "full");
        const offset = Number(params.cursor || 0);
        return {
          data: ordered.slice(offset, offset + params.limit),
          nextCursor: offset === 0 ? "100" : null,
        };
      },
      "legacy-thread",
      { sortDirection },
    );
    assert.deepEqual(
      items,
      turns.flatMap((turn) =>
        turn.items.map((item) => ({ ...item, turnId: turn.id })),
      ),
    );
    assert.equal(calls.length, 3);
    assert(calls.every(({ params }) => params.threadId === "legacy-thread"));
  }
});

test("连接和权限错误保留原始错误，不切换历史接口", async () => {
  let calls = 0;
  await assert.rejects(
    readThreadHistory(async () => {
      calls++;
      throw new Error("连接已断开");
    }, "offline-thread"),
    /连接已断开/,
  );
  assert.equal(calls, 1);
});

test("切换对话后忽略迟到分页与错误并停止回退请求", async () => {
  for (const fail of [false, true]) {
    let current = true;
    let calls = 0;
    const items = await readThreadHistory(
      async () => {
        calls++;
        current = false;
        if (fail) throw new Error("thread/items/list is not supported yet");
        return { data: [], nextCursor: "next" };
      },
      "stale-thread",
      { current: () => current },
    );
    assert.deepEqual(items, []);
    assert.equal(calls, 1);
  }
});

test("首屏回调先交付最近一页，后台分页保留轮内顺序与完整历史", async () => {
  for (const legacy of [false, true]) {
    let completePage;
    const firstPages = [];
    const entry = (n) => ({ item: { id: `item-${n}` }, turnId: `turn-${n}` });
    const loading = readThreadHistory(
      async (method, params) => {
        if (legacy && method === "thread/items/list")
          throw new Error("thread/items/list is not supported yet");
        const records = params.cursor ? [entry(1)] : [entry(3), entry(2)];
        const page = {
          data: legacy
            ? records.map(({ item, turnId }) => ({ id: turnId, items: [item] }))
            : records,
          nextCursor: params.cursor ? null : "older",
        };
        if (params.cursor)
          return new Promise((resolve) => {
            completePage = () => resolve(page);
          });
        return page;
      },
      "progressive-thread",
      { onFirstPage: (items) => firstPages.push(items) },
    );
    // 让首个响应及旧接口回退完成；第二页继续保持未完成状态。
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(
      firstPages.map((items) => items.map((item) => item.id)),
      [["item-2", "item-3"]],
    );
    assert(completePage);
    completePage();
    assert.deepEqual(
      (await loading).map((item) => item.id),
      ["item-1", "item-2", "item-3"],
    );
    assert.equal(firstPages.length, 1);
  }
});
