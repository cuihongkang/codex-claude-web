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
