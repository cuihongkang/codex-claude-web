import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createClaudeAdapter } from "../../server/src/backends/claude/adapter.mjs";
import { messagesServer } from "../helpers/claude-messages-server.mjs";

const directory = await mkdtemp(join(tmpdir(), "dual-backend-sdk-"));
const cwd = join(directory, "workspace");
await mkdir(cwd);
const events = [];
const image =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=";
let sequence = 0,
  requestedWrite = false,
  requestedReadImage = false,
  requestedAsk = false;
const service = await messagesServer((body) => {
  if (!requestedWrite && body.tools?.some((t) => t.name === "Write")) {
    requestedWrite = true;
    return [
      {
        type: "tool_use",
        id: "toolu_fixture_write",
        name: "Write",
        input: { file_path: join(cwd, "proof.txt"), content: "verified\n" },
      },
    ];
  }
  if (!requestedReadImage) {
    requestedReadImage = true;
    return [
      {
        type: "tool_use",
        id: "toolu_fixture_read_image",
        name: "Read",
        input: { file_path: join(cwd, "proof.png") },
      },
    ];
  }
  if (!requestedAsk) {
    requestedAsk = true;
    return [
      {
        type: "tool_use",
        id: "toolu_fixture_question",
        name: "AskUserQuestion",
        input: {
          questions: [
            {
              header: "验证",
              question: "选择验证结果",
              options: [
                { label: "通过", description: "继续" },
                { label: "重试", description: "重试" },
              ],
              multiSelect: false,
            },
          ],
        },
      },
    ];
  }
  return [{ type: "text", text: "双后端验证通过" }];
});
const adapter = createClaudeAdapter({
  backend: {
    id: "claude-test",
    type: "claude",
    executable: process.env.CLAUDE_EXECUTABLE || "claude",
    dataDir: join(directory, "config"),
    stateDir: join(directory, "web-state"),
    args: [],
  },
  config: { defaultCwd: cwd, projectlessRoot: join(directory, "workspaces") },
  providers: {
    list: async () => [{ id: "fixture", models: ["fixture-model"] }],
    get: async () => ({
      id: "fixture",
      baseUrl: service.url,
      apiKey: "synthetic-test-token",
      models: ["fixture-model"],
    }),
  },
  broadcast: (message) => {
    events.push(message);
    if (message.method === "item/tool/requestUserInput")
      queueMicrotask(() =>
        adapter.receive(
          {},
          { id: message.id, result: { answers: { 0: { answers: ["通过"] } } } },
        ),
      );
  },
  send: (client, message) => client.deliver(message),
});
function call(method, params = {}) {
  return new Promise((resolve, reject) =>
    adapter.receive(
      {
        deliver(message) {
          if (message.error) reject(new Error(message.error.message));
          else resolve(message.result);
        },
      },
      { id: ++sequence, method, params },
    ),
  );
}
async function finished(id, count) {
  for (let i = 0; i < 1200; i++) {
    const results = events.filter(
      (e) => e.method === "turn/completed" && e.params.threadId === id,
    );
    if (results.length >= count) {
      assert.equal(
        results.at(-1).params.turn.status,
        "completed",
        JSON.stringify(results.at(-1)),
      );
      return;
    }
    await delay(50);
  }
  throw new Error("等待 Claude 轮次超时：" + JSON.stringify(events.slice(-5)));
}
try {
  await writeFile(join(cwd, "proof.png"), Buffer.from(image, "base64"));
  await adapter.connect();
  assert.equal(adapter.ready, true, JSON.stringify(adapter.state()));
  const { thread } = await call("thread/start", {
    cwd,
    model: "fixture-model",
  });
  await call("turn/start", {
    threadId: thread.id,
    input: [
      { type: "text", text: "写入验证文件" },
      { type: "image", url: `data:image/png;base64,${image}` },
    ],
    model: "fixture-model",
  });
  await finished(thread.id, 1);
  assert.ok(
    service.requests.some((request) =>
      request.messages.some(
        (message) =>
          Array.isArray(message.content) &&
          message.content.some(
            (block) =>
              block.type === "image" &&
              block.source.type === "base64" &&
              block.source.data === image,
          ),
      ),
    ),
  );
  assert.equal(await readFile(join(cwd, "proof.txt"), "utf8"), "verified\n");
  assert.ok(events.some((e) => e.method === "item/tool/requestUserInput"));
  const completed = events.find((e) => e.method === "turn/completed");
  const changed = await call("thread/items/list", { threadId: thread.id });
  assert.ok(
    changed.data.some(
      (record) =>
        record.item.tool === "Read" &&
        record.item.contentItems.some(
          (block) =>
            block.type === "image" && block.url?.startsWith("data:image/"),
        ),
    ),
    "native image tool output uses the shared image renderer contract",
  );
  assert.ok(changed.data.some((r) => r.item.type === "fileChange"));
  await call("lan/files/undo", {
    threadId: thread.id,
    turnId: completed.params.turn.id,
    path: join(cwd, "proof.txt"),
  });
  await assert.rejects(readFile(join(cwd, "proof.txt")), { code: "ENOENT" });
  const first = await call("thread/items/list", {
    threadId: thread.id,
    limit: 1,
  });
  assert.ok(first.data.length);
  assert.ok(first.nextCursor);
  assert.ok(
    changed.data.some(
      (record) =>
        record.item.type === "userMessage" &&
        record.item.content.some(
          (block) =>
            block.type === "image" &&
            block.url === `data:image/png;base64,${image}`,
        ),
    ),
  );
  await call("turn/start", {
    threadId: thread.id,
    input: [{ type: "text", text: "继续验证" }],
    model: "fixture-model",
  });
  await finished(thread.id, 2);
  const history = await call("thread/turns/list", { threadId: thread.id });
  assert.equal(
    history.data.filter((t) => t.items.some((i) => i.type === "userMessage"))
      .length,
    2,
  );
  const branch = await call("thread/fork", { threadId: thread.id });
  assert.notEqual(branch.thread.id, thread.id);
  assert.ok(
    (await call("thread/items/list", { threadId: branch.thread.id })).data
      .length,
  );
  assert.ok(events.some((e) => e.method === "item/agentMessage/delta"));
  console.log(
    JSON.stringify({
      sdk: "0.3.318",
      calls: service.requests.length,
      realFileWrite: true,
      history: true,
      resume: true,
      fork: true,
      streamed: true,
      imageRoundTrip: true,
    }),
  );
} finally {
  adapter.close();
  await service.close();
  await rm(directory, { recursive: true, force: true });
}
