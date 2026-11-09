import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { readConfig } from "../src/config.mjs";
import { createBackendConfiguration } from "../src/backends/configuration.mjs";
import { createProjectModels } from "../src/project-models.mjs";
import { createAuthentication } from "../src/auth.mjs";
import { readTls } from "../src/tls.mjs";
import { providerRuntimeEnvironment } from "../src/backends/claude/provider-environment.mjs";

test("原生默认目录沿用 CLI 默认环境，已有自定义目录原样继承", (t) => {
  const previous = process.env.CLAUDE_CONFIG_DIR;
  t.after(() => {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previous;
  });
  delete process.env.CLAUDE_CONFIG_DIR;
  assert.equal(
    providerRuntimeEnvironment(null, { dataDir: join(homedir(), ".claude") })
      .CLAUDE_CONFIG_DIR,
    undefined,
  );
  process.env.CLAUDE_CONFIG_DIR = "/original/claude";
  assert.equal(
    providerRuntimeEnvironment(null, { dataDir: "/original/claude" })
      .CLAUDE_CONFIG_DIR,
    "/original/claude",
  );
});

test("网页配置目录独立于两种原生 CLI，切换网页目录保留原生目录", () => {
  const defaults = readConfig({});
  assert.equal(defaults.configDir, join(homedir(), ".config", "claudex-web"));
  assert.equal(defaults.codexHome, join(homedir(), ".codex"));
  assert.equal(defaults.claudeHome, join(homedir(), ".claude"));
  const env = {
    CODEX_HOME: "/native/codex",
    CLAUDE_CONFIG_DIR: "/native/claude",
  };
  for (const web of ["/web/first", "/web/second"]) {
    const config = readConfig({ ...env, CLAUDEX_WEB_CONFIG_DIR: web });
    assert.equal(config.codexHome, env.CODEX_HOME);
    assert.equal(config.claudeHome, env.CLAUDE_CONFIG_DIR);
    assert.equal(config.backendsFile, join(web, "backends.json"));
    assert.equal(config.projectlessRoot, join(web, "workspaces"));
  }
  assert.equal(
    readConfig({ XDG_CONFIG_HOME: "/custom-config" }).configDir,
    "/custom-config/claudex-web",
  );
});

test("网页配置、证书、登录状态和项目选择只写网页目录", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "web-config-ownership-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = readConfig({
    CLAUDEX_WEB_CONFIG_DIR: join(root, "web"),
    CODEX_HOME: join(root, "codex"),
    CLAUDE_CONFIG_DIR: join(root, "claude"),
  });
  for (const directory of [config.codexHome, config.claudeHome]) {
    await mkdir(directory);
    await writeFile(join(directory, "original-config"), "preserved");
  }
  const backends = createBackendConfiguration(config);
  const before = (await backends.read()).backends;
  assert.equal(before.find((b) => b.id === "codex").dataDir, config.codexHome);
  const claude = before.find((b) => b.id === "claude");
  assert.equal(claude.dataDir, config.claudeHome);
  assert.equal(claude.stateDir, join(config.configDir, "backends", "claude"));
  await backends.save({ id: "claude", type: "claude", enabled: false });
  await createProjectModels(config.configDir).set({
    cwd: root,
    model: "model",
    effort: "high",
  });
  await createAuthentication(config);
  await readTls(config);
  for (const directory of [config.codexHome, config.claudeHome]) {
    assert.deepEqual(await readdir(directory), ["original-config"]);
    assert.equal(
      await readFile(join(directory, "original-config"), "utf8"),
      "preserved",
    );
  }
  assert.deepEqual((await readdir(config.configDir)).sort(), [
    "auth",
    "backends.json",
    "project-models.json",
    "tls",
  ]);
});

test("原生 Claude 环境保留本机认证与模型配置，显式供应商覆盖独立生效", (t) => {
  const values = {
    ANTHROPIC_AUTH_TOKEN: "native-token",
    ANTHROPIC_API_KEY: "native-key",
    ANTHROPIC_BASE_URL: "https://native.example",
    ANTHROPIC_MODEL: "native-model",
    CLAUDECODE: "nested-session",
  };
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  Object.assign(process.env, values);
  const backend = { dataDir: "/native/claude", stateDir: "/web/claude" };
  const native = providerRuntimeEnvironment(null, backend);
  for (const [key, value] of Object.entries(values)) {
    if (key === "CLAUDECODE") assert.equal(native[key], undefined);
    else assert.equal(native[key], value);
  }
  assert.equal(native.CLAUDE_CONFIG_DIR, backend.dataDir);
  const custom = providerRuntimeEnvironment(
    {
      models: ["custom"],
      baseUrl: "https://custom.example",
      apiKey: "custom-key",
    },
    backend,
  );
  assert.equal(custom.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(custom.ANTHROPIC_API_KEY, "custom-key");
  assert.equal(custom.CLAUDE_CONFIG_DIR, backend.dataDir);
});
