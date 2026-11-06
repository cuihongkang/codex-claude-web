import test from "node:test";
import assert from "node:assert/strict";
import {
  modelRecord,
  createClaudeCatalogue,
} from "../src/backends/claude/catalogue.mjs";
import { providerRuntimeEnvironment } from "../src/backends/claude/provider-environment.mjs";

test("模型参数采用原生元数据，未知模型保留真实配置且不公布猜测参数", () => {
  const record = modelRecord(
    {
      value: "model",
      supportedEffortLevels: ["low", "high"],
      supportsFastMode: true,
      supportsAdaptiveThinking: true,
    },
    "provider",
  );
  assert.deepEqual(
    record.supportedReasoningEfforts.map((e) => e.reasoningEffort),
    ["low", "high"],
  );
  assert.equal(record.serviceTiers[0].id, "fast");
  assert.equal(record.supportsAdaptiveThinking, true);
  assert.equal(record.providerId, "provider");
  assert.deepEqual(modelRecord({ value: "custom" }).serviceTiers, []);
  assert.deepEqual(
    modelRecord({ value: "custom" }).supportedReasoningEfforts,
    [],
  );
});

test("供应商协议在首次运行前确定，Anthropic 保留原生实验协议", () => {
  const backend = { dataDir: "/isolated" };
  const provider = {
    baseUrl: "http://fixture",
    apiKey: "fixture",
    models: ["custom"],
  };
  const standard = providerRuntimeEnvironment(provider, backend, {
    proxy: { url: "http://proxy", token: "proxy-key" },
  });
  assert.equal(standard.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS, undefined);
  assert.equal(standard.ANTHROPIC_BASE_URL, "http://proxy");
  assert.equal(standard.ANTHROPIC_API_KEY, "proxy-key");
  assert.equal(
    providerRuntimeEnvironment(
      {
        ...provider,
        modelCapabilities: { custom: { supportedEffortLevels: ["low"] } },
      },
      backend,
    ).CLAUDE_CODE_EFFORT_LEVEL,
    "unset",
  );
  const native = providerRuntimeEnvironment(
    { ...provider, protocol: "anthropic" },
    backend,
  );
  assert.equal(native.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS, undefined);
  assert.equal(native.CLAUDE_CONFIG_DIR, "/isolated");
  assert.equal(native.ANTHROPIC_MODEL, "custom");
  assert.equal(native.CLAUDECODE, undefined);
});

test("目录读取按供应商和cwd匹配活会话，并保留MCP真实工具", async () => {
  const requested = [];
  const native = {
    initializationResult: async () => ({ account: { apiProvider: "fixture" } }),
    request: async ({ subtype }) => {
      assert.equal(subtype, "list_models");
      return {
        response: {
          models: [{ value: "same", supportedEffortLevels: ["high"] }],
        },
      };
    },
    supportedCommands: async () => [{ name: "skill" }, { name: "terminal" }],
    supportedAgents: async () => [{ name: "agent" }],
    mcpServerStatus: async () => [
      {
        name: "fixture",
        status: "connected",
        config: { env: { SECRET: "private" } },
        tools: [{ name: "actual-tool", description: "real" }],
      },
    ],
  };
  const catalogue = createClaudeCatalogue({
    backend: {
      id: "claude",
      dataDir: "/isolated",
      executable: process.execPath,
      args: ["--eval", "console.log('[]')", "--"],
    },
    providers: {
      get: async (_backend, id) => {
        requested.push(id);
        return { id, models: ["same"] };
      },
    },
    queries: new Map([
      [
        "session",
        {
          cwd: process.cwd(),
          providerId: "right",
          query: native,
          terminalCommands: ["terminal"],
        },
      ],
    ]),
  });
  const result = await catalogue.read({
    cwd: process.cwd(),
    providerId: "right",
  });
  assert.deepEqual(requested, ["right"]);
  assert.equal(result.models[0].providerId, "right");
  assert.deepEqual(result.models[0].supportedReasoningEfforts, []);
  assert.equal(result.mcp[0].tools["actual-tool"].description, "real");
  assert.equal(result.mcp[0].config, undefined);
  assert.equal(result.commands[0].name, "skill");
  catalogue.close();
});

test("CLI默认模型目录只在原生身份已认证时进入可选模型", async () => {
  for (const [account, expected] of [
    [{ tokenSource: "none", apiProvider: "firstParty" }, 0],
    [{ tokenSource: "oauth", apiProvider: "firstParty" }, 1],
    [{ apiKeySource: "apiKeyHelper", apiProvider: "firstParty" }, 1],
  ]) {
    const catalogue = createClaudeCatalogue({
      backend: {
        id: "claude",
        executable: process.execPath,
        args: ["--eval", "console.log('[]')", "--"],
        dataDir: "/isolated",
      },
      providers: { get: async () => null },
      queries: new Map([
        [
          "native",
          {
            cwd: process.cwd(),
            providerId: "",
            query: {
              initializationResult: async () => ({ account }),
              request: async () => ({
                response: { models: [{ value: "opus" }] },
              }),
              supportedCommands: async () => [],
              supportedAgents: async () => [],
              mcpServerStatus: async () => [],
            },
          },
        ],
      ]),
    });
    const result = await catalogue.read({ cwd: process.cwd() });
    assert.equal(result.models.length, expected);
    assert.deepEqual(result.account, account);
    catalogue.close();
  }
});
