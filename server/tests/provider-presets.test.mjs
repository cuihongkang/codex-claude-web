import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackendConfiguration } from "../src/backends/configuration.mjs";
import { createProviders } from "../src/backends/providers.mjs";
import {
  configuredProviders,
  providerPresets,
} from "../src/backends/provider-presets.mjs";
import { providerRuntimeEnvironment } from "../src/backends/claude/provider-environment.mjs";

test("默认供应商必须提供已打包的品牌图标，并始终排在自定义供应商之前", async () => {
  for (const preset of providerPresets) {
    assert.match(preset.icon, /^[a-z0-9-]+$/);
    const svg = await readFile(
      new URL(
        `../../client/src/assets/providers/${preset.icon}.svg`,
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(svg, /<svg\b/);
  }
  const custom = [{ id: "custom-b" }, { id: "custom-a" }];
  for (const apiKey of ["", "key"]) {
    const result = configuredProviders([...custom, { id: "deepseek", apiKey }]);
    assert.deepEqual(
      result.map((p) => p.id),
      [...providerPresets.map((p) => p.id), "custom-b", "custom-a"],
    );
    assert.equal(result[0].enabled, Boolean(apiKey));
  }
});

test("默认供应商空凭据停用、填写启用、持久恢复及清空撤销", async (t) => {
  const configDir = await mkdtemp(join(tmpdir(), "provider-presets-"));
  t.after(() => rm(configDir, { recursive: true, force: true }));
  const config = {
    configDir,
    codexHome: join(configDir, "codex"),
    claudeHome: join(configDir, "claude"),
    upstreamUrl: "ws://127.0.0.1:8765",
  };
  const providers = createProviders(createBackendConfiguration(config));
  assert.deepEqual(await providers.list(), []);
  const [preset] = await providers.list("claude", { includeDisabled: true });
  assert.equal(preset.id, "deepseek");
  assert.equal(preset.enabled, false);
  assert.equal(preset.hasApiKey, false);
  assert.equal("apiKey" in preset, false);
  await assert.rejects(providers.get("claude", preset.id), /已停用/);
  await providers.save({
    id: preset.id,
    backendId: "claude",
    apiKey: " test-key ",
    baseUrl: "https://untrusted.example",
    models: ["wrong-model"],
    modelCapabilities: {},
  });
  const restored = createProviders(createBackendConfiguration(config));
  const [active] = await restored.list();
  assert.equal(active.enabled, true);
  assert.equal(active.hasApiKey, true);
  assert.equal(JSON.stringify(active).includes("test-key"), false);
  const provider = await restored.get("claude", preset.id);
  const environment = providerRuntimeEnvironment(provider, {
    dataDir: config.claudeHome,
  });
  assert.equal(
    environment.ANTHROPIC_BASE_URL,
    "https://api.deepseek.com/anthropic",
  );
  assert.equal(environment.ANTHROPIC_API_KEY, "test-key");
  assert.equal(environment.ANTHROPIC_MODEL, "deepseek-flash");
  assert.equal(environment.CLAUDE_CODE_MAX_CONTEXT_TOKENS, "1048576");
  assert.deepEqual(
    provider.modelCapabilities["deepseek-flash"].supportedEffortLevels,
    ["low", "high", "max"],
  );
  // 旧版设置的连接与模型覆盖同样归一化为当前官方定义。
  const storage = createBackendConfiguration(config);
  await storage.update((data) => ({
    ...data,
    providers: data.providers.map((p) => ({
      ...p,
      baseUrl: "https://old.example",
      models: ["old"],
      modelCapabilities: {},
    })),
  }));
  const normalized = await restored.get("claude", preset.id);
  assert.equal(normalized.baseUrl, "https://api.deepseek.com/anthropic");
  assert.equal(normalized.apiKey, "test-key");
  assert.deepEqual(normalized.models, ["deepseek-flash", "deepseek-v4-pro"]);
  assert.equal(
    normalized.modelCapabilities["deepseek-v4-pro"].contextWindow,
    1048576,
  );
  await restored.save({ id: preset.id, backendId: "claude", apiKey: "  " });
  assert.deepEqual(await restored.list(), []);
  assert.equal(
    (await restored.list("claude", { includeDisabled: true }))[0].hasApiKey,
    false,
  );
  assert.equal(
    (await readFile(join(configDir, "backends.json"), "utf8")).includes(
      "test-key",
    ),
    false,
  );
  await assert.rejects(restored.get("claude", preset.id), /已停用/);
  await restored.remove({ id: preset.id });
  assert.equal(
    (await restored.list("claude", { includeDisabled: true }))[0].id,
    preset.id,
  );
  assert.deepEqual(await restored.list("codex", { includeDisabled: true }), []);
});
