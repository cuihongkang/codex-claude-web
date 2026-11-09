import test from "node:test";
import assert from "node:assert/strict";
import {
  referenceToolParams,
  readReferenceThread,
} from "../src/backends/codex/reference-tools.mjs";

test("只读引用配置覆盖新建、恢复和分支，并保留使用者配置", () => {
  const params = {
    cwd: "/workspace",
    config: {
      model: "custom",
      "mcp_servers.existing": { command: "existing" },
    },
  };
  for (const method of ["thread/start", "thread/resume", "thread/fork"]) {
    const result = referenceToolParams(method, params, {
      upstreamUrl: "wss://example.test/native",
    });
    assert.equal(result.cwd, params.cwd);
    assert.equal(result.config.model, "custom");
    assert.deepEqual(result.config["mcp_servers.existing"], {
      command: "existing",
    });
    assert.equal(
      result.config["mcp_servers.claudex_references"].env
        .CLAUDEX_REFERENCE_UPSTREAM,
      "wss://example.test/native",
    );
    assert(
      result.config["mcp_servers.claudex_references"].args[0].endsWith(
        "/reference-mcp.mjs",
      ),
    );
  }
  assert.equal(referenceToolParams("thread/read", params, {}), params);
  assert.equal(params.config["mcp_servers.claudex_references"], undefined);
});

test("read_thread 只读取同后端消息，分页按时间正序并保留原生游标", async () => {
  const calls = [];
  const result = await readReferenceThread(
    async (method, params) => {
      calls.push([method, params]);
      if (method === "thread/read")
        return { thread: { id: "saved", name: "参考会话", cwd: "/workspace" } };
      return {
        data: [
          {
            id: "new",
            items: [
              { type: "reasoning", text: "内部" },
              { type: "agentMessage", text: "新正文" },
            ],
          },
          {
            id: "old",
            items: [
              {
                type: "userMessage",
                content: [{ type: "text", text: "旧正文" }],
              },
            ],
          },
        ],
        nextCursor: "older",
      };
    },
    { threadId: "saved", turnLimit: 2, cursor: "page" },
  );
  assert.equal(result.nextCursor, "older");
  assert.deepEqual(
    result.turns.map((turn) => turn.id),
    ["old", "new"],
  );
  assert.deepEqual(result.turns[1].items, [
    { type: "agentMessage", text: "新正文" },
  ]);
  assert.equal(calls[1][1].cursor, "page");
  assert.equal(calls[1][1].itemsView, "full");
  await assert.rejects(
    readReferenceThread(null, { threadId: "backend:claude:saved" }),
    /同一 Codex 后端/,
  );
  await assert.rejects(
    readReferenceThread(null, { threadId: "saved", turnLimit: 0 }),
    /1～100/,
  );
});

test("原生读取错误直接返回，不替换为另一会话或空结果", async () => {
  await assert.rejects(
    readReferenceThread(
      async () => {
        throw new Error("历史读取失败");
      },
      { threadId: "saved" },
    ),
    /历史读取失败/,
  );
});
