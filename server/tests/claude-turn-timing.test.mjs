import test from "node:test";
import assert from "node:assert/strict";
import { historyTurns } from "../src/backends/claude/messages.mjs";

test("活动轮次历史读取保留开始时间，工具活动不产生结束时间", () => {
  const messages = [
    {
      type: "user",
      uuid: "user",
      timestamp: "2026-11-06T00:00:00Z",
      message: { content: [{ type: "text", text: "读取源码" }] },
    },
    {
      type: "assistant",
      uuid: "tool",
      timestamp: "2026-11-06T00:00:30Z",
      message: {
        id: "api",
        content: [
          {
            type: "tool_use",
            id: "read",
            name: "Read",
            input: { file_path: "/workspace/source.js" },
          },
        ],
        stop_reason: "tool_use",
      },
    },
  ];
  const startedAt = Date.parse(messages[0].timestamp) / 1000;
  const saved = { user: { id: "user", status: "inProgress", startedAt } };
  const [active] = historyTurns(messages, saved);
  assert.equal(active.startedAt, startedAt);
  assert.equal(active.completedAt, undefined);
  assert.equal(active.status, "inProgress");
  const completedAt = startedAt + 45;
  const [finished] = historyTurns(messages, {
    user: { ...saved.user, status: "completed", completedAt },
  });
  assert.equal(finished.completedAt, completedAt);
});
