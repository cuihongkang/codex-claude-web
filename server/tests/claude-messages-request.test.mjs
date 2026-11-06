import test from "node:test";
import assert from "node:assert/strict";
import { messagesRequest } from "../src/backends/claude/messages-request.mjs";
import {
  providerRuntimeEnvironment,
  providerModelEnvironment,
} from "../src/backends/claude/provider-environment.mjs";
import { modelOptions } from "../src/backends/claude/model-options.mjs";

test("模型支持元数据交给原生能力规则，保持思考启停独立", () => {
  assert.equal(
    modelOptions({ protocol: "messages" }, "custom", {}).thinking,
    undefined,
  );
  for (const enabled of [true, false])
    assert.deepEqual(
      modelOptions(
        {
          protocol: "messages",
          modelCapabilities: { custom: { supportsAdaptiveThinking: enabled } },
        },
        "custom",
        {},
      ).thinking,
      undefined,
    );
  assert.equal(
    providerModelEnvironment(
      {
        modelCapabilities: {
          custom: {
            supportsAdaptiveThinking: false,
            supportedEffortLevels: ["xhigh"],
          },
        },
      },
      "custom",
      "xhigh",
    ).CLAUDE_CODE_MODEL_CAPABILITIES,
    "custom=-adaptive_thinking,effort,xhigh_effort,-max_effort",
  );
});

test("标准 Messages 保留原生思考控制、空工具与评估 schema", () => {
  const body = {
    model: "custom-model",
    messages: [{ role: "user", content: "检查条件" }],
    tools: [],
    output_config: {
      format: {
        type: "json_schema",
        schema: { type: "object", properties: { ok: { type: "boolean" } } },
      },
    },
  };
  const translated = messagesRequest(body);
  assert.deepEqual(translated.thinking, { type: "disabled" });
  assert.deepEqual(translated.tools, []);
  assert.deepEqual(translated.output_config, body.output_config);
  assert.equal(body.thinking, undefined, "保持原生输入快照独立");
  for (const thinking of [
    { type: "disabled" },
    { type: "adaptive" },
    { type: "enabled", budget_tokens: 4096 },
  ])
    assert.deepEqual(
      messagesRequest({ ...body, thinking }).thinking,
      thinking,
      "原生显式控制完整传递",
    );
});

test("供应商环境保留结构化输出所需的原生功能并按实际选择传递 effort", () => {
  const provider = {
    protocol: "messages",
    baseUrl: "https://provider.example",
    apiKey: "fixture",
    models: ["custom-model"],
  };
  const backend = { dataDir: "/tmp/claude-environment-test" };
  const automatic = providerRuntimeEnvironment(provider, backend);
  assert.equal(automatic.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS, undefined);
  assert.equal(automatic.CLAUDE_CODE_EFFORT_LEVEL, "unset");
  assert.equal(
    providerRuntimeEnvironment(provider, backend, { effort: "low" })
      .CLAUDE_CODE_EFFORT_LEVEL,
    "low",
  );
});
