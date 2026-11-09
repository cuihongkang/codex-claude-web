import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createClaudeRuntime } from "../../server/src/backends/claude/runtime.mjs";
import { createStorage } from "../../server/src/backends/storage.mjs";
import { createCompactions } from "../../server/src/compaction.mjs";
import { createSessionReader } from "../../server/src/backends/claude/history.mjs";
import { historyTurns } from "../../server/src/backends/claude/messages.mjs";
import { messagesServer } from "../helpers/claude-messages-server.mjs";

const dir = await mkdtemp(join(tmpdir(), "claude-thinking-native-"));
const cwd = join(dir, "workspace");
await mkdir(cwd);
const thought = "单段思考保持完整正文。".repeat(160);
const content = [
  { type: "thinking", thinking: thought, signature: "fixture-signature" },
  {
    type: "thinking",
    thinking: "下一段思考\n\n保留段落。",
    signature: "second-signature",
  },
  { type: "redacted_thinking", data: "fixture-encrypted-payload" },
  { type: "text", text: "完成" },
];
const service = await messagesServer((body) =>
  ["enabled", "adaptive"].includes(body.thinking?.type)
    ? content
    : [{ type: "text", text: "未开启思考" }],
);
const models = ["fixture-model", "adaptive-model", "default-model"];
const modelCapabilities = Object.fromEntries(
  models.map((model, index) => [
    model,
    {
      supportedEffortLevels: ["xhigh"],
      ...(index < 2 && { supportsAdaptiveThinking: index === 1 }),
      ...(index < 2 && { contextWindow: index === 0 ? 196608 : 65536 }),
    },
  ]),
);
const id = randomUUID();
const events = [],
  native = [];
const storage = createStorage(join(dir, "index.json"), {
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
const backend = {
  id: "claude",
  executable: process.env.CLAUDE_EXECUTABLE || "claude",
  dataDir: join(dir, "config"),
  stateDir: join(dir, "web-state"),
  args: [],
};
const broadcast = (event) => events.push(event);
const runtime = createClaudeRuntime({
  backend,
  storage,
  broadcast,
  observeMessage: (_id, message) => native.push(message),
  providers: {
    get: async () => ({
      id: "fixture",
      protocol: "messages",
      baseUrl: service.url,
      apiKey: "test",
      models,
      modelCapabilities,
    }),
  },
  compactions: createCompactions(broadcast),
  questions: new Map(),
});
const readSession = createSessionReader(backend);
try {
  await runtime.check();
  let query;
  for (let round = 0; round < 3; round++) {
    const before = service.requests.length;
    const { turn } = await runtime.enqueue(id, {
      input: [{ type: "text", text: `思考显示验证 ${round}` }],
      model: models[round],
      effort: "xhigh",
    });
    let completed;
    for (let i = 0; i < 1200; i++) {
      completed = events.find(
        (e) => e.method === "turn/completed" && e.params.turn.id === turn.id,
      );
      if (completed) break;
      await delay(25);
    }
    assert.equal(completed?.params.turn.status, "completed");
    const request = service.requests
      .slice(before)
      .find((body) => body.tools?.some((tool) => tool.name === "Bash"));
    assert.equal(request.output_config.effort, "xhigh");
    assert.equal(request.thinking.type, round === 0 ? "enabled" : "adaptive");
    assert.equal(request.thinking.display, "summarized");
    if (round === 0)
      assert.equal(request.thinking.budget_tokens, request.max_tokens - 1);
    if (query) assert.equal(runtime.queries.get(id).query, query);
    query = runtime.queries.get(id).query;
    const usage = await query.getContextUsage({ detail: "summary" });
    assert.equal(
      usage.rawMaxTokens,
      round === 0 ? 196608 : round === 1 ? 65536 : 200000,
    );
    const deltas = events.filter(
      (e) =>
        e.method === "item/reasoning/summaryTextDelta" &&
        e.params.turnId === turn.id,
    );
    assert.equal(deltas.length, 2);
    assert.equal(deltas[0].params.delta, thought);
    assert.ok(deltas.every((e) => e.params.summaryTitle === "思考"));
    const reasoning = completed.params.turn.items.filter(
      (i) => i.type === "reasoning",
    );
    assert.equal(
      reasoning.length,
      3,
      JSON.stringify({
        items: completed.params.turn.items,
        native: native.filter((m) => m.type === "assistant"),
      }),
    );
    assert.deepEqual(
      reasoning.map((i) => i.summary),
      content.slice(0, 3).map((b) => [
        {
          title: "思考",
          text: b.type === "thinking" ? b.thinking : "思考内容已加密",
        },
      ]),
    );
    assert.equal(reasoning[0].id, deltas[0].params.itemId);
    assert.ok(reasoning.every((i) => i.turnId === turn.id));
    const session = (await storage.read()).sessions[id];
    const messages = await readSession(
      "getSessionMessages",
      session.nativeSessionId || id,
      { dir: cwd, includeSystemMessages: true },
    );
    const recovered = historyTurns(
      messages,
      session.turns,
      session.turnIds,
      session.inputTurns,
    ).find((t) => t.id === turn.id);
    assert.deepEqual(
      recovered.items.filter((i) => i.type === "reasoning"),
      reasoning,
    );
  }
  assert.ok(
    native.some(
      (m) =>
        m.type === "stream_event" && m.event?.delta?.type === "signature_delta",
    ),
  );
  const assistants = native.filter((m) => m.type === "assistant");
  assert.ok(
    assistants.some((m) =>
      m.message.content.some(
        (b) => b.type === "thinking" && b.signature === "fixture-signature",
      ),
    ),
  );
  console.log(
    "真实 Claude CLI 三轮 thinking 策略、xhigh、动态容量、签名、加密块及原生历史一致性通过",
  );
} finally {
  await runtime.close();
  await service.close();
  await rm(dir, { recursive: true, force: true });
}
