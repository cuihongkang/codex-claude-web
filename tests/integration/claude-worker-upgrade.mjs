import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  cp,
  symlink,
  appendFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createClaudeWorkerAdapter } from "../../server/src/backends/claude/worker-client.mjs";
import { messagesServer } from "../helpers/claude-messages-server.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "claude-worker-upgrade-"));
const cwd = join(directory, "workspace");
await mkdir(cwd);
const backend = {
  id: "claude",
  type: "claude",
  enabled: true,
  executable: process.env.CLAUDE_EXECUTABLE || "claude",
  dataDir: join(directory, "data"),
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
        id: "toolu_upgrade_background",
        name: "Bash",
        input: {
          command: "sleep 90",
          description: "升级期间保留后台任务",
          run_in_background: true,
        },
      },
    ];
  }
  return [{ type: "text", text: "升级验证" }];
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
const dependencies = {
  backend,
  config,
  broadcast: (event) => events.push(event),
  send: (client, message) => client.deliver(message),
};
const old = createClaudeWorkerAdapter(dependencies);
let replacement;
let sequence = 0;
const call = (adapter, method, params) =>
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
async function until(predicate, description) {
  for (let i = 0; i < 1600; i++) {
    if (await predicate()) return;
    await delay(25);
  }
  throw new Error(`等待超时：${description}`);
}
try {
  await old.connect();
  const { thread } = await call(old, "thread/start", {
    cwd,
    model: "fixture-model",
    providerId: "fixture",
  });
  const turn = await call(old, "turn/start", {
    threadId: thread.id,
    input: [{ type: "text", text: "升级前后台任务" }],
  });
  await until(
    () =>
      events.some(
        (event) =>
          event.method === "turn/completed" &&
          event.params.turn.id === turn.turn.id,
      ),
    "原后端轮次完成",
  );
  const pid = old.workerPid;
  const install = join(directory, "new-install");
  await cp(join(root, "server", "src"), join(install, "server", "src"), {
    recursive: true,
  });
  await cp(join(root, "shared"), join(install, "shared"), { recursive: true });
  await cp(join(root, "package.json"), join(install, "package.json"));
  await symlink(
    join(root, "node_modules"),
    join(install, "node_modules"),
    "dir",
  );
  await appendFile(
    join(install, "server/src/backends/claude/runtime.mjs"),
    "\n// Isolated same-version upgrade fixture.\n",
  );
  const upgraded = await import(
    pathToFileURL(join(install, "server/src/backends/claude/worker-client.mjs"))
      .href
  );
  replacement = upgraded.createClaudeWorkerAdapter(dependencies);
  await replacement.connect();
  assert.equal(replacement.workerPid, pid, "有后台工作时保留原worker");
  assert.equal(replacement.state().params.pendingUpdate, true);
  assert.equal(
    (
      await call(replacement, "thread/backgroundTerminals/list", {
        threadId: thread.id,
      })
    ).data.length,
    1,
  );
  await call(old, "thread/backgroundTerminals/clean", { threadId: thread.id });
  await until(
    () => replacement.ready && replacement.workerPid !== pid,
    "空闲后替换同版本但不同源码的worker",
  );
  const newPid = replacement.workerPid;
  await until(
    () => old.ready && old.workerPid === newPid,
    "旧桥接重连新版worker",
  );
  await delay(1500);
  assert.equal(replacement.workerPid, newPid, "旧桥接不把后端反复降回旧源码");
  const options = JSON.parse(
    await readFile(join(backend.stateDir, "worker-options.json"), "utf8"),
  );
  assert.ok(options.revision.entry.startsWith(install));
  assert.equal(
    options.revision.version,
    JSON.parse(await readFile(join(root, "package.json"), "utf8")).version,
  );
  await replacement.shutdown();
  replacement.close();
  old.close();
  await rm(install, { recursive: true, force: true });
  replacement = createClaudeWorkerAdapter(dependencies);
  await replacement.connect();
  assert.equal(
    replacement.ready,
    true,
    "停机升级后从当前安装启动，不沿用已删除的旧入口",
  );
  const offlineOptions = JSON.parse(
    await readFile(join(backend.stateDir, "worker-options.json"), "utf8"),
  );
  assert.ok(offlineOptions.revision.entry.startsWith(root));
  await replacement.shutdown();
  replacement.close();
  console.log(
    "Claude worker upgrade passed: same-version source hash, busy pending update, idle replacement, old-client convergence, offline installation replacement, install without package-lock",
  );
} finally {
  old.close();
  if (replacement) {
    await replacement.shutdown().catch(() => {});
    replacement.close();
  }
  await service.close();
  await rm(directory, { recursive: true, force: true });
}
