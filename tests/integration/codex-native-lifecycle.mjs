import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  copyFile,
  chmod,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { once } from "node:events";
import { fullAccessParams } from "../../client/src/domain/execution-policy.js";

const source = process.env.CODEX_VALIDATION_HOME;
if (!source)
  throw new Error(
    "请通过 CODEX_VALIDATION_HOME 指定已配置模型与认证的 Codex 目录。",
  );
const executable = process.env.CODEX_EXECUTABLE || "codex";
const version = execFileSync(executable, ["--version"], {
  encoding: "utf8",
}).trim();
const directory = await mkdtemp(join(tmpdir(), "codex-native-validation-"));
const home = join(directory, "config"),
  cwd = join(directory, "workspace");
await mkdir(home, { mode: 0o700 });
await mkdir(cwd);
for (const name of ["config.toml", "auth.json"]) {
  try {
    await copyFile(join(source, name), join(home, name));
    await chmod(join(home, name), 0o600);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
const events = [],
  results = [],
  pending = new Map();
let child,
  lines,
  sequence = 0;
function call(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} 请求超时`));
    }, 120000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(
      JSON.stringify({ id, method, params: fullAccessParams(method, params) }) +
        "\n",
    );
  });
}
async function connect() {
  child = spawn(executable, ["app-server", "--stdio"], {
    env: { ...process.env, CODEX_HOME: home },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.resume();
  lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    if (message.method) {
      events.push(message);
      return;
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  child.once("exit", () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("隔离 Codex app-server 已退出"));
    }
    pending.clear();
  });
  await call("initialize", {
    clientInfo: { name: "codex_web_native_validation", version: "3.1.1" },
    capabilities: { experimentalApi: true },
  });
  child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
}
async function disconnect() {
  lines?.close();
  if (!child || child.exitCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  await exited;
}
async function turn(threadId, text, model) {
  const start = events.length;
  const acknowledged = await call("turn/start", {
    threadId,
    model,
    input: [{ type: "text", text }],
  });
  for (let i = 0; i < 4800; i++) {
    const completion = events
      .slice(start)
      .find(
        (event) =>
          event.method === "turn/completed" &&
          event.params.threadId === threadId &&
          event.params.turn.id === acknowledged.turn.id,
      );
    if (completion) {
      assert.equal(
        completion.params.turn.status,
        "completed",
        JSON.stringify(completion.params.turn),
      );
      results.push({
        operation: "turn/start",
        status: completion.params.turn.status,
      });
      return;
    }
    await delay(50);
  }
  throw new Error("Codex 真实模型轮次执行超时");
}
try {
  await connect();
  const models = await call("model/list");
  const model =
    process.env.CODEX_MODEL ||
    models.data.find((entry) => entry.isDefault)?.model;
  assert.ok(model, "隔离配置提供实际可用的默认模型");
  const { thread } = await call("thread/start", { cwd, model });
  await turn(
    thread.id,
    "仅在当前目录执行验证：创建 proof.txt，内容精确为 native-harness-proof 加换行，然后读取文件确认；简短回复结果。",
    model,
  );
  assert.equal(
    await readFile(join(cwd, "proof.txt"), "utf8"),
    "native-harness-proof\n",
  );
  const found = await call("fuzzyFileSearch", { query: "proof", roots: [cwd] });
  assert.ok(found.files.some((file) => file.path === "proof.txt"));
  const file = await call("fs/readFile", { path: join(cwd, "proof.txt") });
  assert.equal(
    Buffer.from(file.dataBase64, "base64").toString(),
    "native-harness-proof\n",
  );
  await disconnect();
  await connect();
  await call("thread/resume", { threadId: thread.id });
  await turn(
    thread.id,
    "继续刚才的验证，仅回复已写入的文件标记，保持文件内容。",
    model,
  );
  const branch = await call("thread/fork", { threadId: thread.id });
  await turn(
    branch.thread.id,
    "这是独立分支，读取 proof.txt 并回复标记和 BRANCH。",
    model,
  );
  const history = await call("thread/turns/list", {
    threadId: thread.id,
    itemsView: "full",
  });
  assert.ok(history.data.length >= 2);
  const report = {
    version,
    results,
    actualFileWrite: true,
    nativeFileSuggestions: true,
    nativeFileRead: true,
    appServerRestartRecovery: true,
    fork: true,
    history: true,
  };
  await mkdir(".cache/backend-acceptance", { recursive: true });
  await writeFile(
    ".cache/backend-acceptance/codex-live.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  await disconnect();
  await rm(directory, { recursive: true, force: true });
}
