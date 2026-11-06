import assert from "node:assert/strict";
import { fork, execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  rm,
  readFile,
  writeFile,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { once } from "node:events";
import { createClaudeWorkerAdapter } from "../../server/src/backends/claude/worker-client.mjs";
import { workerLocation } from "../../server/src/backends/claude/worker-location.mjs";
import { messagesServer } from "../helpers/claude-messages-server.mjs";

const directory = await mkdtemp(join(tmpdir(), "claude-worker-restart-"));
const cwd = join(directory, "workspace");
await mkdir(cwd);
const backend = {
  id: "claude",
  type: "claude",
  enabled: true,
  executable: process.env.CLAUDE_EXECUTABLE || "claude",
  dataDir: join(directory, "config"),
  stateDir: join(directory, "web-state"),
  args: [],
};
const config = {
  configDir: directory,
  claudeHome: join(directory, ".claude"),
  codexHome: directory,
  backendsFile: join(directory, "backends.json"),
  defaultCwd: cwd,
  projectlessRoot: join(directory, "workspaces"),
};
let started = false;
const service = await messagesServer((body) => {
  if (!started && body.tools?.some((tool) => tool.name === "Bash")) {
    started = true;
    return [
      {
        type: "tool_use",
        id: "toolu_restart_background",
        name: "Bash",
        input: {
          command: "sleep 90",
          description: "重启验证后台终端",
          run_in_background: true,
        },
      },
    ];
  }
  return [{ type: "text", text: "重启验证完成" }];
});
await writeFile(
  config.backendsFile,
  JSON.stringify({
    version: 1,
    backends: [backend],
    providers: [
      {
        id: "fixture",
        backendId: "claude",
        name: "Fixture",
        protocol: "messages",
        baseUrl: service.url,
        apiKey: "test-token",
        models: ["fixture-model"],
      },
    ],
  }),
  { mode: 0o600 },
);
const events = [];
let adapter;
const worker = fork(
  new URL("../helpers/claude-runtime-worker.mjs", import.meta.url),
  [],
  { stdio: ["ignore", "pipe", "pipe", "ipc"] },
);
worker.on("message", (event) => events.push(event));
worker.stderr.on("data", (data) => process.stderr.write(data));
async function until(predicate, description) {
  for (let i = 0; i < 1600; i++) {
    if (await predicate()) return;
    await delay(25);
  }
  throw new Error(
    `等待超时：${description}\n${JSON.stringify(events.slice(-6))}`,
  );
}
async function running(expected) {
  try {
    const raw = await readFile(`/proc/${expected.pid}/stat`, "utf8");
    const fields = raw.slice(raw.lastIndexOf(")") + 2).split(" ");
    return fields[19] === expected.startTime && !["Z", "X"].includes(fields[0]);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
let sequence = 0;
const call = (method, params) =>
  new Promise((resolve, reject) =>
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
try {
  worker.send({ backend, config, cwd });
  await until(
    () => events.some((event) => event.control === "connected"),
    "连接独立后端服务",
  );
  const connected = events.find((event) => event.control === "connected");
  const id = connected.threadId;
  await until(
    () =>
      events.some(
        (event) =>
          event.method === "turn/completed" && event.params.threadId === id,
      ),
    "初始前台轮次完成",
  );
  const before = JSON.parse(
    await readFile(join(backend.stateDir, "codex-web-index.json"), "utf8"),
  ).sessions[id];
  assert.ok(
    Object.values(before.backgroundTasks).some(
      (task) => task.status === "running",
    ),
  );
  assert.ok(before.nativeChildren.length > 0);
  const ended = once(worker, "exit");
  worker.kill("SIGKILL");
  await ended;
  await delay(150);
  assert.equal(
    await running(before.nativeProcess),
    true,
    "桥接SIGKILL后原生Claude进程继续存活",
  );
  assert.ok(
    (await Promise.all(before.nativeChildren.map(running))).some(Boolean),
    "后台shell继续运行",
  );
  adapter = createClaudeWorkerAdapter({
    backend,
    config,
    broadcast: (event) => events.push(event),
    send: (client, message) => client.deliver(message),
  });
  await adapter.connect();
  assert.equal(adapter.workerPid, connected.pid, "重连复用原独立worker");
  assert.ok(adapter.state().params.backgroundTasks[id].length > 0);
  const list = await call("thread/backgroundTerminals/list", { threadId: id });
  assert.equal(list.data.length, 1);
  await assert.rejects(adapter.shutdown(), /仍有运行任务/);
  assert.equal(
    await running(before.nativeProcess),
    true,
    "拒绝忙时shutdown后保留实际进程",
  );
  await call("thread/backgroundTerminals/clean", { threadId: id });
  assert.equal(
    (await call("thread/backgroundTerminals/list", { threadId: id })).data
      .length,
    0,
  );
  const resumed = await call("turn/start", {
    threadId: id,
    input: [{ type: "text", text: "核对桥接重启后的原生会话恢复" }],
  });
  await until(
    () =>
      events.some(
        (event) =>
          event.method === "turn/completed" &&
          event.params.turn.id === resumed.turn.id,
      ),
    "恢复会话继续执行",
  );
  const after = JSON.parse(
    await readFile(join(backend.stateDir, "codex-web-index.json"), "utf8"),
  ).sessions[id];
  assert.equal(after.nativeProcess.pid, before.nativeProcess.pid);
  const location = workerLocation(backend);
  assert.equal((await stat(location.directory)).mode & 0o777, 0o700);
  assert.equal((await stat(location.socket)).mode & 0o777, 0o600);
  const { stdout } = await promisify(execFile)("systemctl", [
    "--user",
    "show",
    location.unit,
    "--property=ControlGroup",
    "--property=MainPID",
    "--value",
  ]);
  assert.ok(
    stdout.includes(String(connected.pid)),
    "真实systemd用户服务持有独立worker",
  );
  const workerGroup = await readFile(`/proc/${connected.pid}/cgroup`, "utf8");
  const bridgeGroup = await readFile(`/proc/${process.pid}/cgroup`, "utf8");
  assert.notEqual(
    workerGroup,
    bridgeGroup,
    "后端与网页桥接处于独立systemd cgroup",
  );
  await until(
    () => Object.keys(adapter.state().params.activeTurns).length === 0,
    "空闲状态同步",
  );
  await adapter.shutdown();
  adapter.close();
  console.log(
    "Claude worker restart passed: independent systemd cgroup, bridge SIGKILL preserves identical native PID and background task, IPC reconnect and cleanup, busy shutdown rejection, confirmed idle shutdown",
  );
} finally {
  worker.kill("SIGKILL");
  if (adapter) {
    await adapter.shutdown().catch(() => {});
    adapter.close();
  }
  await service.close();
  await rm(directory, { recursive: true, force: true });
}
