import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createSessionReader } from "../../server/src/backends/claude/history.mjs";
import { forkHistory } from "../../server/src/backends/claude/history-actions.mjs";
import { createClaudeSessions } from "../../server/src/backends/claude/sessions.mjs";
import { createStorage } from "../../server/src/backends/storage.mjs";

const root = await mkdtemp(join(tmpdir(), "claude-native-fork-boundary-"));
try {
  const cwd = join(root, "workspace"),
    dataDir = join(root, "config");
  const project = join(dataDir, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
  await mkdir(cwd);
  await mkdir(project, { recursive: true });
  const id = randomUUID(),
    first = randomUUID(),
    second = randomUUID();
  const answer = randomUUID(),
    attachment = randomUUID(),
    internal = randomUUID();
  const entries = [
    {
      type: "user",
      uuid: first,
      parentUuid: null,
      message: { role: "user", content: "Keep this turn" },
    },
    {
      type: "assistant",
      uuid: answer,
      parentUuid: first,
      message: {
        role: "assistant",
        id: "answer",
        content: [{ type: "text", text: "Kept answer" }],
        stop_reason: "end_turn",
      },
    },
    {
      type: "attachment",
      uuid: attachment,
      parentUuid: answer,
      attachment: {
        type: "structured_output",
        data: { proof: "KEPT_NATIVE_OUTPUT" },
      },
    },
    {
      type: "user",
      uuid: internal,
      parentUuid: attachment,
      message: { role: "user", content: "/goal clear" },
    },
    {
      type: "user",
      uuid: second,
      parentUuid: internal,
      message: { role: "user", content: "Discard this turn" },
    },
    {
      type: "assistant",
      uuid: randomUUID(),
      parentUuid: second,
      message: {
        role: "assistant",
        id: "discarded",
        content: [{ type: "text", text: "Discarded answer" }],
        stop_reason: "end_turn",
      },
    },
  ].map((entry, index) => ({
    ...entry,
    sessionId: id,
    cwd,
    timestamp: new Date(1700000000000 + index * 1000).toISOString(),
  }));
  await writeFile(
    join(project, `${id}.jsonl`),
    entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
  );
  const readSession = createSessionReader({ dataDir });
  const projected = await readSession("getSessionMessages", id, { dir: cwd });
  assert.equal(
    projected.length,
    5,
    "the native message projection omits structured-output attachments",
  );
  assert.equal(projected[2].parentUuid, attachment);
  const session = {
    id,
    cwd,
    turns: {},
    internalInputIds: { [internal]: true },
  };
  const sessions = createClaudeSessions({
    config: { defaultCwd: cwd },
    storage: createStorage(join(dataDir, "index.json"), {
      sessions: { [id]: { ...session, initialized: true } },
    }),
    readSession,
    runtime: { running: new Map(), releaseSession: async () => {} },
    compactions: { busy: () => false },
    notify() {},
    assertReady() {},
  });
  const visible = await sessions.turns(id);
  assert.equal(visible.length, 2);
  assert.ok(!JSON.stringify(visible).includes("/goal clear"));
  const fork = await forkHistory(readSession, session, [{ id: first }]);
  const records = (
    await readFile(join(project, `${fork.nativeSessionId}.jsonl`), "utf8")
  )
    .trim()
    .split("\n")
    .map(JSON.parse);
  const output = records.find(
    (record) => record.forkedFrom?.messageUuid === attachment,
  );
  assert.deepEqual(output.attachment.data, { proof: "KEPT_NATIVE_OUTPUT" });
  assert.ok(
    !records.some((record) => record.forkedFrom?.messageUuid === second),
  );
  const users = records.filter((record) => record.type === "user");
  assert.equal(users.length, 2);
  assert.equal(fork.internalInputIds[users[1].uuid], true);
  assert.equal(fork.turnIds[users[1].uuid], undefined);
  assert.equal(
    fork.turnIds[users[0].uuid],
    first,
    "logical turn mapping follows native forkedFrom UUIDs",
  );
  const complete = await forkHistory(readSession, session, [
    { id: first },
    { id: second },
  ]);
  const full = (
    await readFile(join(project, `${complete.nativeSessionId}.jsonl`), "utf8")
  )
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.equal(full.filter((record) => record.type === "user").length, 3);
  assert.ok(
    full.some(
      (record) => record.attachment?.data?.proof === "KEPT_NATIVE_OUTPUT",
    ),
  );
  console.log(
    "native fork preserves the kept turn's output attachment and UUID provenance",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
