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
    settings.save({
      id: "codex",
      type: "codex",
      name: "远端",
      url: "ws://example.org",
    }),
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
    modelCapabilities: {
      model: { supportedEffortLevels: [], contextWindow: 196608 },
    },
  });
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
  assert.equal((await stat(config.backendsFile)).mode & 0o777, 0o600);
  assert.equal(
    (await createBackendConfiguration(config).read()).backends.length,
    2,
  );
});
