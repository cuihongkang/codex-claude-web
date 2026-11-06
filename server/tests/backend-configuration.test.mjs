import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackendConfiguration } from "../src/backends/configuration.mjs";
import { createProviders } from "../src/backends/providers.mjs";

test("配置恢复、独立凭据及失败写入保留旧配置", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "backend-config-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = {
    configDir: directory,
    claudeHome: join(directory, ".claude"),
    codexHome: directory,
    upstreamUrl: "ws://127.0.0.1:8765",
    backendsFile: join(directory, "backends.json"),
  };
  const settings = createBackendConfiguration(config),
    providers = createProviders(settings);
  await settings.save({
    id: "claude",
    type: "claude",
    name: "Claude",
    enabled: true,
  });
  await assert.rejects(
    createBackendConfiguration({
      ...config,
      upstreamUrl: "ws://example.org",
    }).save({ id: "codex", type: "codex" }),
    /WSS/,
  );
  await assert.rejects(
    settings.save({ id: "second", type: "claude", name: "Second" }),
    /两个固定后端/,
  );
  await assert.rejects(
    providers.save({ backendId: "codex" }),
    /仅用于 Claude Code/,
  );
  await providers.save({
    id: "vendor",
    backendId: "claude",
    name: "供应商",
    baseUrl: "https://example.org",
    models: ["model"],
    apiKey: "test-secret",
    modelAliases: { model: "  日常模型  " },
    modelCapabilities: {
      model: { supportedEffortLevels: [], contextWindow: 196608 },
    },
  });
  assert.equal((await providers.list())[0].modelAliases.model, "日常模型");
  const persisted = createProviders(createBackendConfiguration(config));
  assert.equal((await persisted.list())[0].modelAliases.model, "日常模型");
  await assert.rejects(
    providers.save({
      id: "vendor",
      backendId: "claude",
      name: "供应商",
      baseUrl: "https://example.org",
      models: ["model"],
      modelAliases: { unknown: "别名" },
    }),
    /模型显示别名无效/,
  );
  assert.equal(
    (await providers.list())[0].modelCapabilities.model.contextWindow,
    196608,
  );
  await assert.rejects(
    providers.save({
      id: "vendor",
      backendId: "claude",
      name: "供应商",
      baseUrl: "https://example.org",
      models: ["model"],
      modelCapabilities: {
        model: { supportedEffortLevels: [], contextWindow: 0 },
      },
    }),
    /模型参数配置无效/,
  );
  assert.equal(
    JSON.stringify(await providers.list()).includes("test-secret"),
    false,
  );
  await providers.save({
    id: "vendor",
    backendId: "claude",
    name: "改名",
    baseUrl: "https://example.org",
    models: ["other"],
  });
  assert.equal((await providers.get("claude", "vendor")).apiKey, "test-secret");
  assert.deepEqual((await providers.list())[0].modelAliases, {});
  assert.deepEqual((await providers.list())[0].models, ["other"]);
  assert.equal((await stat(config.backendsFile)).mode & 0o777, 0o600);
  assert.equal(
    (await createBackendConfiguration(config).read()).backends.length,
    2,
  );
});

test("旧网页程序路径和目录恢复为原生环境，启停保存保留供应商", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "backend-native-config-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = {
    configDir: directory,
    codexHome: join(directory, "codex"),
    claudeHome: join(directory, "claude"),
    upstreamUrl: "ws://127.0.0.1:8765",
  };
  const settings = createBackendConfiguration(config);
  await settings.update(() => ({
    backends: [
      {
        id: "claude",
        type: "claude",
        enabled: true,
        executable: "/debug/claude",
        args: ["debug"],
        dataDir: "/debug/config",
      },
    ],
    providers: [{ id: "vendor" }],
  }));
  const backend = (await settings.read()).backends.find(
    (b) => b.id === "claude",
  );
  assert.equal(backend.executable, "claude");
  assert.equal(backend.dataDir, config.claudeHome);
  assert.deepEqual(backend.args, []);
  await settings.save({ id: "claude", type: "claude", enabled: false });
  const restored = await settings.read();
  assert.equal(restored.backends.find((b) => b.id === "claude").enabled, false);
  assert.deepEqual(restored.providers, [{ id: "vendor" }]);
});

test("Claude 执行服务的供应商读取独立于 Codex 连接配置", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "claude-provider-config-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = {
    configDir: directory,
    codexHome: join(directory, "codex"),
    claudeHome: join(directory, "claude"),
  };
  const configuration = createBackendConfiguration(config);
  await configuration.update((data) => ({
    ...data,
    providers: [
      {
        id: "vendor",
        backendId: "claude",
        enabled: true,
        name: "Vendor",
        baseUrl: "https://example.org",
        models: ["model"],
        apiKey: "test-key",
      },
    ],
  }));
  const providers = createProviders(configuration);
  assert.equal(
    (await providers.list("claude")).find((p) => p.id === "vendor").hasApiKey,
    true,
  );
  assert.equal((await providers.get("claude", "vendor")).apiKey, "test-key");
  assert.equal(await providers.get("claude", ""), null);
  await providers.save({
    id: "vendor",
    backendId: "claude",
    name: "Renamed",
    baseUrl: "https://example.org",
    models: ["model"],
  });
  assert.equal((await providers.get("claude", "vendor")).name, "Renamed");
});
