import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readTranscript, transcriptMessage } from "../src/claude-history.mjs";
import { mergeClaudeMessages } from "../src/claude-timeline.mjs";
const stamp = (n) => new Date(1700000000000 + n * 1000).toISOString();
const message = (id, time, historyOrder) => ({
  id,
  role: "user",
  kind: "user",
  timestamp: stamp(time),
  historyOrder,
  content: [{ type: "text", text: "repeated question" }],
});
test("queued prompts retain source identity, arrays and original position across replay", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "claude-timeline-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "history.jsonl");
  await writeFile(
    path,
    [
      {
        type: "user",
        uuid: "first",
        timestamp: stamp(1),
        message: { content: "first" },
      },
      {
        type: "assistant",
        uuid: "answer",
        timestamp: stamp(5),
        message: { content: "working" },
      },
      {
        type: "attachment",
        uuid: "attachment-id",
        timestamp: stamp(6),
        renderedRole: "system",
        attachment: {
          type: "queued_command",
          source_uuid: "steer",
          timestamp: stamp(4),
          commandMode: "prompt",
          prompt: [
            { type: "text", text: "old supplementary question" },
            { type: "image", source: { type: "base64", data: "test" } },
          ],
        },
      },
      {
        type: "assistant",
        uuid: "latest",
        timestamp: stamp(8),
        message: { content: "latest answer" },
      },
    ]
      .map(JSON.stringify)
      .join("\n"),
  );
  const history = await readTranscript(path);
  assert.deepEqual(
    history.map((m) => m.id),
    ["first", "answer", "steer", "latest"],
  );
  assert.equal(history[2].kind, "user");
  assert.equal(history[2].content[1].type, "image");
  const replay = { ...history[2] };
  delete replay.historyOrder;
  delete replay.timestamp;
  const merged = mergeClaudeMessages(history, [replay]);
  assert.deepEqual(
    merged.map((m) => m.id),
    history.map((m) => m.id),
  );
  assert.equal(merged[2].timestamp, stamp(4));
});
test("task notifications are system messages and unrelated attachments stay internal", () => {
  const message = transcriptMessage({
    type: "attachment",
    uuid: "file-id",
    attachment: {
      type: "queued_command",
      source_uuid: "notification",
      commandMode: "task-notification",
      prompt: "task done",
    },
  });
  assert.equal(message.id, "notification");
  assert.equal(message.kind, "system");
  assert.equal(
    transcriptMessage({
      type: "attachment",
      attachment: { type: "total_tokens_reminder", text: "internal" },
    }),
    null,
  );
});
test("cached tail plus delayed older events stays chronological and distinct repeated questions survive", () => {
  const history = [
    message("old", 1, 10),
    message("middle", 2, 20),
    message("latest", 4, 40),
  ];
  const result = mergeClaudeMessages(history.slice(1), [
    message("old", 1),
    message("new", 5),
    { ...message("middle", 2), timestamp: undefined },
  ]);
  assert.deepEqual(
    result.map((m) => m.id),
    ["old", "middle", "latest", "new"],
  );
  assert.equal(result[1].historyOrder, 20);
  assert.equal(result[1].timestamp, stamp(2));
});
test("live partials retain position, removals work, and transcript metadata wins over legacy snapshots", () => {
  const old = { ...message("notification", 1, 10), kind: "system" };
  assert.equal(
    mergeClaudeMessages([old], [message("notification", 1)])[0].kind,
    "system",
  );
  const events = [
    message("prompt", 2),
    { id: "partial", role: "assistant", content: [] },
    message("earlier", 1),
  ];
  assert.deepEqual(
    mergeClaudeMessages([], events).map((m) => m.id),
    ["earlier", "prompt", "partial"],
  );
  assert(
    !mergeClaudeMessages(events, [], ["partial"]).some(
      (m) => m.id === "partial",
    ),
  );
});
