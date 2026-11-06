import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  symlink,
  readdir,
  rm,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConfig } from "../../server/src/config.mjs";
import { createBackendConfiguration } from "../../server/src/backends/configuration.mjs";
import { createClaudeCatalogue } from "../../server/src/backends/claude/catalogue.mjs";
import { createSessionReader } from "../../server/src/backends/claude/history.mjs";
import { createClaudeAdapter } from "../../server/src/backends/claude/adapter.mjs";
import { messagesServer } from "../helpers/claude-messages-server.mjs";
import { setTimeout as delay } from "node:timers/promises";

const root = await mkdtemp(join(tmpdir(), "claude-native-configuration-"));
const cwd = join(root, "workspace");
const config = readConfig({
  CODEX_HOME: join(root, "native-codex"),
  CLAUDE_CONFIG_DIR: join(root, "native-claude"),
  CODEX_WEB_CONFIG_DIR: join(root, "web"),
});
const backend = (await createBackendConfiguration(config).read()).backends.find(
  (b) => b.id === "claude",
);
backend.executable = process.env.CLAUDE_EXECUTABLE || "claude";
const catalogue = createClaudeCatalogue({
  backend,
  providers: { get: async () => null },
});
let adapter;
let service;
try {
  const shared = join(root, "shared-skills");
  const project = join(
    backend.dataDir,
    "projects",
    cwd.replace(/[^a-zA-Z0-9]/g, "-"),
  );
  await Promise.all([
    mkdir(cwd),
    mkdir(project, { recursive: true }),
    mkdir(join(shared, "original-skill"), { recursive: true }),
  ]);
  const originalSettings = JSON.stringify({
    model: "native-config-probe-model",
    env: {
      ANTHROPIC_AUTH_TOKEN: "original-native-token",
      ANTHROPIC_BASE_URL: "http://127.0.0.1:1",
      ANTHROPIC_MODEL: "native-config-probe-model",
    },
  });
  await writeFile(join(backend.dataDir, "settings.json"), originalSettings);
  await writeFile(
    join(shared, "original-skill", "SKILL.md"),
    "---\nname: original-skill\ndescription: Original CLI shared skill\n---\nShared skill body.\n",
  );
  await symlink("shared-skills", join(root, "user-skills"));
  await symlink("../user-skills", join(backend.dataDir, "skills"));
  const id = randomUUID();
  const uuid = randomUUID();
  await writeFile(
    join(project, `${id}.jsonl`),
    JSON.stringify({
      type: "user",
      uuid,
      parentUuid: null,
      sessionId: id,
      cwd,
      timestamp: new Date().toISOString(),
      message: { role: "user", content: "Original native conversation" },
    }) + "\n",
  );
  assert(
    (await catalogue.skills({ cwd })).some(
      (skill) => skill.name === "original-skill",
    ),
  );
  assert.equal(
    (await catalogue.settings({ cwd })).applied.model,
    "native-config-probe-model",
  );
  const messages = await createSessionReader(backend)(
    "getSessionMessages",
    id,
    { dir: cwd },
  );
  assert.equal(messages[0].uuid, uuid);
  assert.equal(messages[0].message.content, "Original native conversation");
  const originalFiles = await readdir(backend.dataDir);
  assert(!originalFiles.some((name) => /^(codex-web|worker-)/.test(name)));
  await assert.rejects(readdir(backend.stateDir), { code: "ENOENT" });
  service = await messagesServer(() => [
    { type: "text", text: "Provider selection preserved" },
  ]);
  const events = [];
  adapter = createClaudeAdapter({
    backend,
    config,
    providers: {
      get: async () => ({
        id: "fixture",
        models: ["fixture-model"],
        baseUrl: service.url,
        apiKey: "fixture-token",
      }),
    },
    broadcast: (event) => events.push(event),
    send: (client, message) => client.deliver(message),
  });
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
  await adapter.connect();
  const { thread } = await call("thread/start", {
    cwd,
    providerId: "fixture",
    model: "fixture-model",
  });
  const { turn } = await call("turn/start", {
    threadId: thread.id,
    input: [{ type: "text", text: "Original configuration provider proof" }],
  });
  const deadline = Date.now() + 20000;
  let completed;
  while (
    !(completed = events.find(
      (event) =>
        event.method === "turn/completed" && event.params.turn.id === turn.id,
    ))
  ) {
    assert(Date.now() < deadline, "配置供应商应通过隔离服务完成首轮请求");
    await delay(20);
  }
  assert.equal(completed.params.turn.status, "completed");
  assert(
    service.requests.some((body) =>
      JSON.stringify(body.messages).includes(
        "Original configuration provider proof",
      ),
    ),
  );
  assert.equal(
    await readFile(join(backend.dataDir, "settings.json"), "utf8"),
    originalSettings,
  );
  console.log(
    JSON.stringify({
      originalSettings: true,
      linkedUserSkills: true,
      originalHistory: true,
      separateWebState: true,
      explicitProviderPreservesNativeSettings: true,
    }),
  );
} finally {
  adapter?.close();
  catalogue.close();
  await service?.close();
  await rm(root, { recursive: true, force: true });
}
