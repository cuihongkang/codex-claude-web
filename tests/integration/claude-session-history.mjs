import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  createSessionReader,
  page,
} from "../../server/src/backends/claude/history.mjs";
import { createClaudeSessions } from "../../server/src/backends/claude/sessions.mjs";
import { createStorage } from "../../server/src/backends/storage.mjs";
import { historyTurns } from "../../server/src/backends/claude/messages.mjs";

const root = await mkdtemp(join(tmpdir(), "claude-history-"));
try {
  const cwd = join(root, "workspace"),
    dataDir = join(root, "claude");
  const project = join(dataDir, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
  await mkdir(cwd, { recursive: true });
  await mkdir(project, { recursive: true });
  const id = randomUUID(),
    first = randomUUID(),
    second = randomUUID();
  let parentUuid = null;
  const entries = [];
  const append = (type, uuid, content, extra = {}) => {
    entries.push({
      type,
      uuid,
      parentUuid,
      sessionId: id,
      cwd,
      timestamp: new Date(1700000000000 + entries.length * 1000).toISOString(),
      message: {
        role: type,
        content,
        ...(type === "assistant" && {
          id: `msg-${uuid}`,
          stop_reason: "end_turn",
        }),
      },
      ...extra,
    });
    parentUuid = uuid;
  };
  append("user", first, "first prompt");
  append("assistant", randomUUID(), [{ type: "text", text: "first answer" }]);
  append("user", second, "second prompt");
  append(
    "assistant",
    randomUUID(),
    [{ type: "text", text: "gateway failed" }],
    { isApiErrorMessage: true, error: "api_error" },
  );
  await writeFile(
    join(project, `${id}.jsonl`),
    entries.map((e) => JSON.stringify(e)).join("\n") + "\n",
  );
  const steer = randomUUID();
  entries.splice(2, 0, {
    type: "user",
    uuid: steer,
    parentUuid: entries[1].uuid,
    sessionId: id,
    cwd,
    message: { role: "user", content: "Additional constraint" },
  });
  entries[3].parentUuid = steer;
  const agentId = "test-agent",
    toolId = "agent-tool-1";
  entries[1].message.content.push({
    type: "tool_use",
    id: toolId,
    name: "Agent",
    input: {
      prompt: "Inspect workspace",
      description: "Workspace audit",
      subagent_type: "Explore",
    },
  });
  await writeFile(
    join(project, `${id}.jsonl`),
    entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
  );
  const agentsDir = join(project, id, "subagents");
  await mkdir(agentsDir, { recursive: true });
  const childFirst = randomUUID(),
    childLast = randomUUID();
  const childEntries = [
    {
      type: "user",
      uuid: childFirst,
      parentUuid: null,
      sessionId: id,
      agentId,
      isSidechain: true,
      message: { role: "user", content: "Inspect workspace" },
    },
    {
      type: "assistant",
      uuid: randomUUID(),
      parentUuid: childFirst,
      sessionId: id,
      agentId,
      isSidechain: true,
      message: {
        role: "assistant",
        id: "child-answer-1",
        content: [{ type: "text", text: "Inspection complete" }],
        stop_reason: "end_turn",
      },
    },
  ];
  childEntries.push({
    type: "user",
    uuid: childLast,
    parentUuid: childEntries[1].uuid,
    sessionId: id,
    agentId,
    isSidechain: true,
    message: { role: "user", content: "Check test coverage too" },
  });
  await writeFile(
    join(agentsDir, `agent-${agentId}.jsonl`),
    childEntries.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
  );
  await writeFile(
    join(agentsDir, `agent-${agentId}.meta.json`),
    JSON.stringify({ agentType: "Explore", toolUseId: toolId }),
  );
  const readSession = createSessionReader({ dataDir });
  const raw = await readSession("getSessionMessages", id, { dir: cwd });
  assert.equal(raw.length, 5);
  const converted = historyTurns(raw, {}, {}, { [steer]: first });
  assert.equal(converted[1].status, "failed");
  assert.equal(converted[1].items.length, 1);
  assert.equal(converted[0].startedAt, 1700000000);
  const legacyError =
    'API Error: 500 {"error":{"message":"Jinja Exception: System message must be at the beginning. at line 106"}}';
  const legacy = structuredClone(raw);
  legacy.at(-1).message.content = [{ type: "text", text: legacyError }];
  const legacyTurn = historyTurns(legacy, {}, {}, { [steer]: first })[1];
  assert.equal(legacyTurn.status, "failed");
  assert.equal(legacyTurn.error.code, "providerProtocol");
  assert.equal(legacyTurn.error.retryable, true);
  assert.match(legacyTurn.error.message, /供应商无法处理当前请求格式/);
  assert.ok(!legacyTurn.error.message.includes("Jinja"));
  assert.equal(legacyTurn.error.details, legacyError);
  assert.equal(legacyTurn.items.length, 1);
  const storage = createStorage(join(dataDir, "index.json"), {
    sessions: {
      [id]: {
        id,
        cwd,
        initialized: true,
        inputTurns: { [steer]: first },
        serviceTier: "fast",
        turns: {},
        queue: [],
        createdAt: 1700000000,
        updatedAt: 1700000003,
      },
    },
  });
  const runtime = { running: new Map(), releaseSession: async () => {} };
  const sessions = createClaudeSessions({
    config: { defaultCwd: cwd },
    storage,
    readSession,
    runtime,
    compactions: { busy: () => false },
    notify() {},
    assertReady() {},
  });
  assert.equal(
    (await sessions.request("thread/resume", { threadId: id })).serviceTier,
    "fast",
  );
  const projected = structuredClone(raw.slice(0, 2));
  projected[1].message.stop_reason = null;
  const planItemId = `${projected[1].message.id}-0`;
  const restored = historyTurns(projected, {
    [first]: {
      id: first,
      mode: "plan",
      items: [
        {
          id: planItemId,
          type: "plan",
          phase: "final_answer",
          text: "discard cached body",
        },
      ],
    },
  });
  assert.equal(restored[0].items[1].type, "plan");
  assert.equal(restored[0].items[1].phase, "final_answer");
  assert.equal(restored[0].items[1].text, "first answer");
  const parentTurns = await sessions.turns(id);
  assert.equal(
    parentTurns[0].items.find((item) => item.type === "subAgentActivity")
      .prompt,
    "Inspect workspace",
  );
  const childId = `agent/${id}/${agentId}`;
  const childTurns = await sessions.turns(childId);
  assert.equal(childTurns.length, 2);
  assert.equal(childTurns[0].items[0].authorLabel, "主代理");
  assert.equal(
    childTurns[1].items[0].content[0].text,
    "Check test coverage too",
  );
  const received = await sessions.request("lan/agents/messages", {
    threadId: childId,
  });
  assert.equal(received.messages.length, 2);
  await sessions.request("thread/revert", {
    threadId: id,
    beforeTurnId: second,
  });
  const reverted = await sessions.turns(id);
  assert.equal(reverted.length, 1);
  assert.equal(reverted[0].id, first);
  assert.equal(reverted[0].items[0].id, first);
  assert.equal(reverted[0].items[1].text, "first answer");
  assert.equal(
    reverted[0].items.filter((item) => item.type === "userMessage").length,
    2,
  );
  const retainedChild = await sessions.turns(childId);
  assert.equal(retainedChild.length, 2);
  const index = await storage.read();
  assert.notEqual(index.sessions[id].nativeSessionId, id);
  const list = await sessions.request("thread/list", {});
  assert.deepEqual(
    list.data.map((s) => s.id),
    [id],
  );
  const fork = await sessions.request("thread/fork", { threadId: id });
  assert.equal((await sessions.turns(fork.thread.id)).length, 1);
  await sessions.request("thread/name/set", { threadId: id, name: "renamed" });
  assert.equal((await sessions.session(id)).name, "renamed");
  await sessions.request("thread/delete", { threadId: id });
  assert.deepEqual(
    (await sessions.request("thread/list", {})).data.map((s) => s.id),
    [fork.thread.id],
  );
  const resumedId = randomUUID(),
    wakeId = randomUUID(),
    afterWake = randomUUID();
  const wakeEntries = structuredClone(entries.slice(0, 2)).map((entry) => ({
    ...entry,
    sessionId: resumedId,
  }));
  wakeEntries.push({
    type: "assistant",
    uuid: wakeId,
    parentUuid: wakeEntries[1].uuid,
    sessionId: resumedId,
    cwd,
    message: {
      role: "assistant",
      id: "wake-message",
      content: [{ type: "text", text: "Background task completed" }],
      stop_reason: "end_turn",
    },
  });
  wakeEntries.push({
    type: "user",
    uuid: afterWake,
    parentUuid: wakeId,
    sessionId: resumedId,
    cwd,
    message: { role: "user", content: "Continue after task" },
  });
  await writeFile(
    join(project, `${resumedId}.jsonl`),
    wakeEntries.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
  );
  await storage.update((data) => ({
    ...data,
    sessions: {
      ...data.sessions,
      [resumedId]: {
        id: resumedId,
        cwd,
        initialized: true,
        queue: [],
        turns: {
          [wakeId]: {
            id: wakeId,
            nativeAnchorId: wakeId,
            nativeMessageIds: [wakeId],
            status: "completed",
            items: [],
          },
        },
      },
    },
  }));
  const withWake = await sessions.turns(resumedId);
  assert.deepEqual(
    withWake.map((turn) => turn.id),
    [first, wakeId, afterWake],
  );
  assert.equal(withWake[1].items[0].text, "Background task completed");
  const wakeFork = await sessions.request("thread/fork", {
    threadId: resumedId,
    lastTurnId: wakeId,
  });
  assert.deepEqual(
    (await sessions.turns(wakeFork.thread.id)).map((turn) => turn.id),
    [first, wakeId],
  );
  await sessions.request("thread/revert", {
    threadId: resumedId,
    beforeTurnId: afterWake,
  });
  assert.deepEqual(
    (await sessions.turns(resumedId)).map((turn) => turn.id),
    [first, wakeId],
  );
  const records = Array.from({ length: 250 }, (_, i) => i);
  let cursor,
    recovered = [];
  do {
    const result = page(records, { cursor, limit: 37 });
    recovered.push(...result.data);
    cursor = result.nextCursor;
  } while (cursor);
  assert.deepEqual(recovered, records.toReversed());
  console.log(
    "Claude native session fork, stable edit, failure history, alias isolation and pagination passed",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
