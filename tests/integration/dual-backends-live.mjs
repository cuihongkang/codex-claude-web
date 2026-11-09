import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, cp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createClaudeAdapter } from "../../server/src/backends/claude/adapter.mjs";
import { recordModelApi } from "../helpers/record-model-api.mjs";

const baseUrl = process.env.MODEL_BASE_URL,
  model = process.env.MODEL_ID;
if (!baseUrl || !model || !process.env.CLAUDE_EXECUTABLE)
  throw new Error("请设置 MODEL_BASE_URL、MODEL_ID 和 CLAUDE_EXECUTABLE");
const directory = await mkdtemp(join(tmpdir(), "dual-backend-live-")),
  cwd = join(directory, "workspace");
await mkdir(cwd);
const recording = await recordModelApi(baseUrl, join(directory, "model-api"));
const events = [],
  results = [];
let sequence = 0;
function create() {
  return createClaudeAdapter({
    backend: {
      id: "live",
      type: "claude",
      executable: process.env.CLAUDE_EXECUTABLE,
      dataDir: join(directory, "config"),
      args: [],
    },
    config: { defaultCwd: cwd, projectlessRoot: join(directory, "workspaces") },
    providers: {
      list: async () => [{ id: "live", models: [model] }],
      get: async () => ({
        id: "live",
        baseUrl: recording.url,
        apiKey: process.env.MODEL_API_KEY || "",
        models: [model],
      }),
    },
    broadcast: (message) => events.push(message),
    send: (client, message) => client.deliver(message),
  });
}
let adapter = create();
const call = (method, params = {}) =>
  new Promise((resolve, reject) =>
    adapter.receive(
      {
        deliver(m) {
          if (m.error) reject(new Error(m.error.message));
          else resolve(m.result);
        },
      },
      { id: ++sequence, method, params },
    ),
  );
async function run(id, text, method = "turn/start") {
  const start = events.length;
  await call(method, { threadId: id, model, input: [{ type: "text", text }] });
  for (let i = 0; i < 4800; i++) {
    const result = events
      .slice(start)
      .find((e) => e.method === "turn/completed" && e.params.threadId === id);
    if (result) {
      assert.equal(
        result.params.turn.status,
        "completed",
        JSON.stringify(result),
      );
      results.push({ operation: method, status: result.params.turn.status });
      return;
    }
    await delay(50);
  }
  throw new Error("真实模型执行超时");
}
try {
  await adapter.connect();
  assert.ok(adapter.ready, JSON.stringify(adapter.state()));
  const { thread } = await call("thread/start", { cwd, model });
  if (process.env.LIVE_SCENARIO !== "goal") {
    await run(
      thread.id,
      `仅在当前目录完成验证：使用 Write 工具创建 ${join(cwd, "proof.txt")}，内容精确为 dual-backend-462 加换行。然后使用 Read 读取文件，再使用 Bash 执行 cat proof.txt。简短回复结果。`,
    );
    assert.equal(
      await readFile(join(cwd, "proof.txt"), "utf8"),
      "dual-backend-462\n",
    );
    adapter.close();
    adapter = create();
    await adapter.connect();
    await run(
      thread.id,
      "继续刚才的验证，只回复已写入文件的标记，不修改文件。",
    );
    const branch = await call("thread/fork", { threadId: thread.id });
    await run(
      branch.thread.id,
      "这是独立分支。回复之前的文件标记，并附加 BRANCH。",
    );
    await run(thread.id, "", "thread/compact/start");
    await run(thread.id, "读取 proof.txt 并简短回复标记。");
    const history = await call("thread/items/list", { threadId: thread.id });
    assert.ok(history.data.length);
  }
  await call("thread/goal/set", {
    threadId: thread.id,
    objective:
      "在当前工作目录创建 goal-proof.txt，内容精确为 native-goal-proof 加换行；使用工具读取并核对后结束目标。",
    origin: "user",
  });
  let goal;
  for (let attempt = 0; attempt < 4800; attempt++) {
    ({ goal } = await call("thread/goal/get", { threadId: thread.id }));
    if (goal.status !== "active") break;
    await delay(50);
  }
  assert.equal(goal.status, "complete", JSON.stringify(goal));
  assert.equal(
    await readFile(join(cwd, "goal-proof.txt"), "utf8"),
    "native-goal-proof\n",
  );
  const report = {
    model,
    results,
    ...(process.env.LIVE_SCENARIO !== "goal" && {
      realFileWrite: true,
      serviceRestartRecovery: true,
      fork: true,
      compact: true,
    }),
    nativeGoal: { status: goal.status, actualFileWrite: true },
    events: events.length,
  };
  adapter.close();
  await recording.close();
  const evidence = join(
    process.cwd(),
    ".cache",
    "backend-acceptance",
    "claude-live",
  );
  await mkdir(evidence, { recursive: true, mode: 0o700 });
  await cp(join(directory, "model-api"), join(evidence, String(Date.now())), {
    recursive: true,
  });
  await writeFile(
    join(evidence, "report.json"),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify(report));
} catch (error) {
  const evidence = join(
    process.cwd(),
    ".cache",
    "native-model-failure",
    String(Date.now()),
  );
  adapter.close();
  await recording.close();
  await writeFile(
    join(directory, "events.json"),
    JSON.stringify(events, null, 2),
    { mode: 0o600 },
  );
  await cp(directory, evidence, { recursive: true });
  console.error(`真实模型失败证据：${evidence}`);
  throw error;
} finally {
  adapter.close();
  await recording.close();
  await rm(directory, { recursive: true, force: true });
}
