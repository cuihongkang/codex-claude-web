import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createClaudeRuntime } from "../../server/src/backends/claude/runtime.mjs";
import { createStorage } from "../../server/src/backends/storage.mjs";
import { createCompactions } from "../../server/src/compaction.mjs";
import { messagesServer } from "../helpers/claude-messages-server.mjs";

const root = await mkdtemp(
  join(tmpdir(), "claude-project-instructions-native-"),
);
const cwd = join(root, "project", "child");
await mkdir(cwd, { recursive: true });
const marker = randomUUID();
const inherited = `ANCESTOR_${marker}`,
  initial = `AGENTS_INITIAL_${marker}`,
  updated = `AGENTS_UPDATED_${marker}`,
  native = `CLAUDE_NATIVE_${marker}`;
await writeFile(join(root, "AGENTS.md"), inherited);
await writeFile(join(cwd, "AGENTS.md"), initial);
await writeFile(join(cwd, "CLAUDE.md"), native);
const service = await messagesServer(() => [
  { type: "text", text: "Verified" },
]);
const id = randomUUID();
const events = [];
const nativeMessages = [];
const storage = createStorage(join(root, "index.json"), {
  sessions: {
    [id]: {
      id,
      cwd,
      model: "fixture-model",
      providerId: "fixture",
      turns: {},
      queue: [],
    },
  },
});
const broadcast = (event) => events.push(event);
const runtime = createClaudeRuntime({
  backend: {
    id: "claude",
    executable: process.env.CLAUDE_EXECUTABLE || "claude",
    dataDir: join(root, "config"),
    stateDir: join(root, "web-state"),
    args: [],
  },
  storage,
  observeMessage: (_threadId, message) => nativeMessages.push(message),
  providers: {
    get: async () => ({
      id: "fixture",
      protocol: "messages",
      baseUrl: service.url,
      apiKey: "test-token",
      models: ["fixture-model"],
    }),
  },
  broadcast,
  compactions: createCompactions(broadcast),
  questions: new Map(),
});
async function send(text) {
  const firstRequest = service.requests.length;
  const { turn } = await runtime.enqueue(id, {
    input: [{ type: "text", text }],
  });
  for (let i = 0; i < 1600; i++) {
    const result = events.find(
      (event) =>
        event.method === "turn/completed" && event.params.turn.id === turn.id,
    );
    if (result) {
      assert.equal(
        result.params.turn.status,
        "completed",
        JSON.stringify(result.params.turn),
      );
      const request = service.requests
        .slice(firstRequest)
        .find(
          (body) =>
            body.tools?.some((tool) => tool.name === "Bash") &&
            JSON.stringify(body.messages).includes(text),
        );
      assert.ok(
        request,
        "the actual Messages request contains the submitted prompt",
      );
      return request;
    }
    await delay(25);
  }
  throw new Error(
    `Native instruction test timed out: ${JSON.stringify(events.slice(-4))}`,
  );
}
function currentContext(request) {
  const texts = [{ content: request.system }, ...request.messages].flatMap(
    (message) =>
      typeof message.content === "string"
        ? [message.content]
        : (message.content || [])
            .filter((block) => block.type === "text")
            .map((block) => block.text),
  );
  return texts.findLast((text) => text.includes("本轮有效 AGENTS 项目指令"));
}
try {
  await runtime.check();
  const first = await send("INSTRUCTIONS_FIRST_PROOF");
  const firstContext = currentContext(first);
  assert.ok(firstContext.includes(inherited));
  assert.ok(firstContext.includes(initial));
  assert.ok(firstContext.indexOf(inherited) < firstContext.indexOf(initial));
  assert.ok(
    JSON.stringify(first).includes(native),
    "native CLAUDE.md remains loaded alongside AGENTS",
  );
  await writeFile(join(cwd, "AGENTS.md"), updated);
  const second = await send("INSTRUCTIONS_UPDATED_PROOF");
  assert.ok(currentContext(second).includes(updated));
  assert.ok(!currentContext(second).includes(initial));
  await rm(join(cwd, "AGENTS.md"));
  const third = await send("INSTRUCTIONS_REMOVED_PROOF");
  assert.ok(currentContext(third).includes(inherited));
  assert.ok(!currentContext(third).includes(updated));
  assert.ok(JSON.stringify(third).includes(native));
  await rm(join(root, "AGENTS.md"));
  const fourth = await send("INSTRUCTIONS_EMPTY_PROOF");
  assert.ok(
    currentContext(fourth).includes("当前有效 AGENTS 项目指令文件列表为空"),
  );
  assert.ok(!currentContext(fourth).includes(inherited));
  assert.ok(JSON.stringify(fourth).includes(native));
  const unreadable = join(cwd, "AGENTS.override.md");
  await mkdir(unreadable);
  const beforeFailure = service.requests.length;
  const failed = await runtime.enqueue(id, {
    input: [{ type: "text", text: "INSTRUCTIONS_READ_ERROR_PROOF" }],
  });
  let failedTurn;
  for (let i = 0; i < 1600; i++) {
    failedTurn = events.find(
      (event) =>
        event.method === "turn/completed" &&
        event.params.turn.id === failed.turn.id,
    )?.params.turn;
    if (failedTurn) break;
    await delay(25);
  }
  assert.ok(
    failedTurn,
    "instruction read failure produces a terminal turn result",
  );
  assert.equal(
    failedTurn.status,
    "failed",
    JSON.stringify({
      failedTurn,
      newRequests: service.requests.length - beforeFailure,
      events: events.slice(-6),
      native: nativeMessages
        .filter((message) => message.type !== "stream_event")
        .slice(-30),
    }),
  );
  assert.equal(
    service.requests
      .slice(beforeFailure)
      .filter(
        (request) =>
          request.tools?.some((tool) => tool.name === "Bash") &&
          JSON.stringify(request.messages).includes(
            "INSTRUCTIONS_READ_ERROR_PROOF",
          ),
      ).length,
    0,
    "failed instruction loading blocks the submitted model request",
  );
  console.log(
    "Native Claude runtime loads scoped AGENTS, preserves CLAUDE, and refreshes changes and deletion each turn",
  );
} finally {
  runtime.close();
  await service.close();
  await rm(root, { recursive: true, force: true });
}
