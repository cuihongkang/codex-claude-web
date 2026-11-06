import test from "node:test";
import assert from "node:assert/strict";
import {
  historyTurns,
  visibleSessionMessages,
} from "../src/backends/claude/messages.mjs";

test("native internal local commands preserve visible history and activity time", () => {
  const messages = [
    {
      type: "user",
      uuid: "user-1",
      timestamp: "2026-11-06T00:00:00.000Z",
      message: { role: "user", content: "Visible task" },
    },
    {
      type: "assistant",
      uuid: "answer-1",
      timestamp: "2026-11-06T00:00:01.000Z",
      message: {
        id: "native-answer",
        role: "assistant",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Visible answer" }],
      },
    },
    {
      type: "user",
      uuid: "internal-caveat",
      promptId: "native-prompt-2",
      isMeta: true,
      timestamp: "2026-11-06T00:01:00.000Z",
      message: { role: "user", content: "Native command context" },
    },
    {
      type: "user",
      uuid: "internal-command",
      promptId: "native-prompt-2",
      timestamp: "2026-11-06T00:01:01.000Z",
      message: { role: "user", content: "/goal clear" },
    },
    {
      type: "system",
      subtype: "local_command",
      uuid: "internal-output",
      parentUuid: "internal-command",
      timestamp: "2026-11-06T00:01:02.000Z",
      content: "Goal cleared",
    },
  ];
  const visible = visibleSessionMessages(messages, {
    "internal-command": true,
  });
  assert.deepEqual(
    visible.map((message) => message.uuid),
    ["user-1", "answer-1"],
  );
  const turns = historyTurns(visible);
  assert.equal(turns.length, 1);
  assert.equal(
    turns[0].completedAt,
    Date.parse("2026-11-06T00:00:01.000Z") / 1000,
  );
  assert.ok(!JSON.stringify(turns).includes("clear"));
  const manual = visibleSessionMessages(messages);
  assert.ok(
    manual.some((message) => message.uuid === "internal-command"),
    "a user's matching command stays visible without an internal UUID registration",
  );
});

test("原生后台通知和中断记录保持内部归属，正文相同的人类输入仍展示", () => {
  const user = (uuid, text, extra = {}) => ({
    type: "user",
    uuid,
    timestamp: "2026-11-06T00:00:00Z",
    message: { content: [{ type: "text", text }] },
    ...extra,
  });
  const notification =
    "<task-notification><task-id>fixture</task-id></task-notification>";
  const records = [
    user("human", "执行检查", { origin: { kind: "human" } }),
    user("task", notification, {
      origin: { kind: "task-notification" },
      timestamp: "2026-11-06T01:00:00Z",
    }),
    user("interrupt", "[Request interrupted by user]", {
      isVisibleInTranscriptOnly: true,
    }),
    user("synthetic", "内部状态", { isSynthetic: true }),
    user("quoted", notification, { origin: { kind: "human" } }),
  ];
  const turns = historyTurns(records);
  assert.equal(turns.length, 2);
  assert.deepEqual(
    turns.flatMap((t) => t.items).map((i) => i.id),
    ["human", "quoted"],
  );
  assert.equal(turns[0].completedAt, Date.parse(records[0].timestamp) / 1000);
});
