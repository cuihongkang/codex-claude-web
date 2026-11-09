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
async function send(text, directory) {
  const firstRequest = service.requests.length;
  const { turn } = await runtime.enqueue(id, {
    input: [{ type: "text", text }],
    ...(directory && { cwd: directory }),
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
  await send("FOLDER_ORIGINAL_HISTORY");
  const destination = join(root, "destination");
  await mkdir(destination);
  await writeFile(join(destination, "AGENTS.md"), "DESTINATION_INSTRUCTIONS");
  const moved = await send("FOLDER_MOVED_HISTORY", destination);
  assert.ok(JSON.stringify(moved.messages).includes("FOLDER_ORIGINAL_HISTORY"));
  assert.ok(currentContext(moved).includes("DESTINATION_INSTRUCTIONS"));
  assert.equal(runtime.queries.get(id).cwd, destination);
  assert.ok(
    nativeMessages.some(
      (message) =>
        message.type === "system" &&
        message.subtype === "init" &&
        message.cwd === destination,
    ),
  );
  const saved = (await storage.read()).sessions[id];
  assert.equal(saved.cwd, destination);
  assert.equal(saved.historySearchAll, true);
  const { createSessionReader } =
    await import("../../server/src/backends/claude/history.mjs");
  const reader = createSessionReader({ dataDir: join(root, "config") });
  const messages = await reader(
    "getSessionMessages",
    saved.nativeSessionId || id,
    { includeSystemMessages: true },
  );
  assert.ok(JSON.stringify(messages).includes("FOLDER_ORIGINAL_HISTORY"));
  assert.ok(JSON.stringify(messages).includes("FOLDER_MOVED_HISTORY"));
  console.log(
    "PASS real Claude CLI directory migration, original history, new instructions and SDK reload (local model fixture)",
  );
} finally {
  runtime.close();
  await service.close();
  await rm(root, { recursive: true, force: true });
}
