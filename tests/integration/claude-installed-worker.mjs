import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  access,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { messagesServer } from "../helpers/claude-messages-server.mjs";

const execute = promisify(execFile);
const repository = process.cwd();
const artifacts = join(
  repository,
  ".cache",
  "backend-acceptance",
  "installed-worker",
);
await mkdir(artifacts, { recursive: true });
const root = await mkdtemp(join(tmpdir(), "codex-web-installed-claude-"));
const prefix = join(root, "prefix"),
  cwd = join(root, "workspace");
await mkdir(cwd);
let adapter, service;
const events = [];
async function until(predicate, description) {
  for (let attempt = 0; attempt < 1600; attempt++) {
    if (await predicate()) return;
    await delay(25);
  }
  throw new Error(
    `Timed out: ${description}\n${JSON.stringify(events.slice(-6))}`,
  );
}
try {
  const build = await execute("npm", ["run", "build"], {
    cwd: repository,
    maxBuffer: 32 * 1024 * 1024,
  });
  await writeFile(join(artifacts, "build.log"), build.stdout + build.stderr);
  const packed = await execute(
    "npm",
    ["pack", "--ignore-scripts", "--json", "--pack-destination", artifacts],
    { cwd: repository, maxBuffer: 8 * 1024 * 1024 },
  );
  const [manifest] = JSON.parse(packed.stdout);
  const archive = join(artifacts, manifest.filename);
  const installed = await execute(
    "npm",
    [
      "install",
      "--prefix",
      prefix,
      "--omit=dev",
      "--no-audit",
      "--no-fund",
      archive,
    ],
    { cwd: root, maxBuffer: 8 * 1024 * 1024 },
  );
  await writeFile(
    join(artifacts, "install.log"),
    installed.stdout + installed.stderr,
  );
  const packageRoot = join(prefix, "node_modules", "codex-web");
  await assert.rejects(access(join(packageRoot, ".git")));
  await assert.rejects(access(join(packageRoot, "package-lock.json")));
  const { createClaudeWorkerAdapter } = await import(
    pathToFileURL(
      join(packageRoot, "server/src/backends/claude/worker-client.mjs"),
    )
  );
  const target = join(cwd, "installed-proof.txt");
  await writeFile(target, "before native tool\n");
  const skillDir = join(cwd, ".claude", "skills", "installed-proof");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    "---\nname: installed-proof\ndescription: Verify the installed package native skill directory.\n---\nRead the installation proof.\n",
  );
  let called = false;
  service = await messagesServer((request) => {
    if (!called && request.tools?.some((tool) => tool.name === "Write")) {
      called = true;
      return [
        {
          type: "tool_use",
          id: "installed-native-write",
          name: "Write",
          input: {
            file_path: target,
            content: "INSTALLED_NATIVE_TOOL_PROOF\n",
          },
        },
      ];
    }
    return [{ type: "text", text: "INSTALLED_NATIVE_ANSWER_PROOF" }];
  });
  const backend = {
    id: "claude",
    type: "claude",
    enabled: true,
    executable: process.env.CLAUDE_EXECUTABLE || "claude",
    dataDir: join(root, "claude-data"),
    stateDir: join(root, "web-state"),
    args: [],
  };
  const config = {
    configDir: join(root, "codex-home"),
    claudeHome: join(join(root, "codex-home"), ".claude"),
    codexHome: join(root, "codex-home"),
    backendsFile: join(root, "backends.json"),
    defaultCwd: cwd,
    projectlessRoot: join(root, "workspaces"),
  };
  await writeFile(
    config.backendsFile,
    JSON.stringify({
      version: 1,
      backends: [backend],
      providers: [
        {
          id: "fixture",
          backendId: "claude",
          name: "Installed fixture",
          protocol: "messages",
          baseUrl: service.url,
          apiKey: "fixture-only",
          models: ["fixture-model"],
        },
      ],
    }),
    { mode: 0o600 },
  );
  adapter = createClaudeWorkerAdapter({
    backend,
    config,
    broadcast: (event) => events.push(event),
    send: (client, response) => client.deliver(response),
  });
  let sequence = 0;
  const call = (method, params) =>
    new Promise((fulfill, reject) =>
      adapter.receive(
        {
          deliver(response) {
            if (response.error) reject(new Error(response.error.message));
            else fulfill(response.result);
          },
        },
        { id: ++sequence, method, params },
      ),
    );
  await adapter.connect();
  await until(() => adapter.state().params.ready, "installed worker startup");
  const { thread } = await call("thread/start", {
    cwd,
    providerId: "fixture",
    model: "fixture-model",
  });
  const context = { threadId: thread.id, providerId: "fixture", cwd };
  const file = await call("fs/readFile", { ...context, path: target });
  assert.equal(
    Buffer.from(file.dataBase64, "base64").toString(),
    "before native tool\n",
  );
  const skills = await call("skills/list", context);
  assert.ok(
    skills.data
      .flatMap((directory) => directory.skills)
      .some((skill) => skill.name === "installed-proof" && skill.native),
  );
  const settings = await call("config/read", context);
  assert.equal(settings.config.model, "fixture-model");
  const started = await call("turn/start", {
    ...context,
    input: [
      {
        type: "text",
        text: "Write the installation proof file using the native Write tool.",
      },
    ],
  });
  await until(
    () =>
      events.some(
        (event) =>
          event.method === "turn/completed" &&
          event.params.turn.id === started.turn.id,
      ),
    "installed native tool turn completion",
  );
  const completed = events.find(
    (event) =>
      event.method === "turn/completed" &&
      event.params.turn.id === started.turn.id,
  );
  assert.equal(
    completed.params.turn.status,
    "completed",
    JSON.stringify(completed),
  );
  assert.equal(await readFile(target, "utf8"), "INSTALLED_NATIVE_TOOL_PROOF\n");
  const history = await call("thread/turns/list", {
    ...context,
    sortDirection: "asc",
  });
  assert.ok(JSON.stringify(history).includes("INSTALLED_NATIVE_ANSWER_PROOF"));
  assert.ok(JSON.stringify(history).includes("installed-native-write"));
  const pid = adapter.workerPid;
  await until(
    () => Object.keys(adapter.state().params.activeTurns).length === 0,
    "idle worker snapshot",
  );
  await adapter.shutdown();
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  const result = {
    package: manifest.id,
    archive: resolve(archive),
    integrity: manifest.integrity,
    installedWithoutGit: true,
    installedWithoutLockfile: true,
    actualCLI: backend.executable,
    workerPid: pid,
    nativeFileRead: true,
    nativeSkills: true,
    nativeSettings: true,
    nativeToolWrite: true,
    nativeHistory: true,
    idleShutdown: true,
  };
  await writeFile(
    join(artifacts, "result.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
} finally {
  if (adapter) {
    await adapter.shutdown().catch(() => {});
    adapter.close();
  }
  await service?.close();
  await rm(root, { recursive: true, force: true });
}
