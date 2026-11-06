import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createSessionReader } from "../../server/src/backends/claude/history.mjs";
import { historyTurns } from "../../server/src/backends/claude/messages.mjs";

const root = await mkdtemp(join(tmpdir(), "claude-provenance-"));
try {
  const cwd = join(root, "project"),
    dataDir = join(root, "native");
  const directory = join(
    dataDir,
    "projects",
    cwd.replace(/[^a-zA-Z0-9]/g, "-"),
  );
  await mkdir(directory, { recursive: true });
  await mkdir(cwd);
  const sessionId = randomUUID();
  let parentUuid = null;
  const entries = [];
  const append = (type, content, extra = {}) => {
    const uuid = randomUUID();
    entries.push({
      type,
      uuid,
      parentUuid,
      sessionId,
      cwd,
      timestamp: new Date(1700000000000 + entries.length * 1000).toISOString(),
      message: {
        role: type,
        content,
        ...(type === "assistant" && {
          id: "msg-" + uuid,
          stop_reason: "end_turn",
        }),
      },
      ...extra,
    });
    parentUuid = uuid;
    return uuid;
  };
  const human = append("user", "检查后台任务", { origin: { kind: "human" } });
  const notification = append(
    "user",
    "<task-notification><task-id>fixture</task-id><summary>检查完成</summary></task-notification>",
    { origin: { kind: "task-notification" } },
  );
  const interrupt = append("user", "[Request interrupted by user]", {
    isVisibleInTranscriptOnly: true,
  });
  append("assistant", [{ type: "text", text: "后台检查已完成。" }]);
  const quote = append("user", "[Request interrupted by user]", {
    origin: { kind: "human" },
  });
  await writeFile(
    join(directory, sessionId + ".jsonl"),
    entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
  );
  const read = createSessionReader({ dataDir });
  const messages = await read("getSessionMessages", sessionId, {
    dir: cwd,
    includeSystemMessages: true,
  });
  assert.equal(
    messages.find((m) => m.uuid === notification).origin.kind,
    "task-notification",
  );
  assert.equal(
    messages.find((m) => m.uuid === interrupt).isVisibleInTranscriptOnly,
    true,
  );
  const turns = historyTurns(messages);
  const users = turns
    .flatMap((t) => t.items)
    .filter((i) => i.type === "userMessage");
  assert.deepEqual(
    users.map((i) => i.id),
    [human, quote],
  );
  assert.equal(turns.length, 2);
  console.log(
    "PASS 真实 SDK 读取保留原生来源，后台通知和中断记录独立于用户正文",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
