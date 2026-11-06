import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function claudeRuntimeEnvironment(backend) {
  const env = { ...process.env };
  const original = resolve(env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"));
  if (resolve(backend.dataDir) !== original)
    env.CLAUDE_CONFIG_DIR = backend.dataDir;
  return env;
}

export function providerModelEnvironment(provider, model, effort) {
  const rules = Object.entries(provider.modelCapabilities || {}).flatMap(
    ([name, metadata]) => {
      const capabilities = [];
      if (typeof metadata.supportsAdaptiveThinking === "boolean")
        capabilities.push(
          metadata.supportsAdaptiveThinking
            ? "adaptive_thinking"
            : "-adaptive_thinking",
        );
      if (Array.isArray(metadata.supportedEffortLevels)) {
        capabilities.push(
          metadata.supportedEffortLevels.length ? "effort" : "-effort",
        );
        for (const level of ["xhigh", "max"])
          capabilities.push(
            `${metadata.supportedEffortLevels.includes(level) ? "" : "-"}${level}_effort`,
          );
      }
      return capabilities.length ? [`${name}=${capabilities.join(",")}`] : [];
    },
  );
  return {
    CLAUDE_CODE_MODEL_CAPABILITIES: rules.join(";"),
    CLAUDE_CODE_MAX_CONTEXT_TOKENS: String(
      provider.modelCapabilities?.[model]?.contextWindow || "",
    ),
    ...((provider.protocol || "messages") === "messages" && {
      CLAUDE_CODE_EFFORT_LEVEL: effort || "unset",
    }),
  };
}

export function providerRuntimeEnvironment(
  provider,
  backend,
  { proxy, model, effort } = {},
) {
  const env = claudeRuntimeEnvironment(backend);
  delete env.CLAUDECODE;
  if (!provider) return env;
  for (const key of [
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_MODEL",
    "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS",
    "CLAUDE_CODE_EFFORT_LEVEL",
  ])
    delete env[key];
  Object.assign(
    env,
    providerModelEnvironment(provider, model || provider.models[0], effort),
  );
  env.ANTHROPIC_BASE_URL = proxy?.url || provider.baseUrl;
  env.ANTHROPIC_API_KEY = proxy?.token || provider.apiKey;
  env.ANTHROPIC_MODEL = model || provider.models[0];
  for (const level of ["OPUS", "SONNET", "HAIKU"])
    env[`ANTHROPIC_DEFAULT_${level}_MODEL`] = env.ANTHROPIC_MODEL;
  return env;
}

// 显式供应商通过 CLI 会话级设置覆盖生效，原生配置文件保持原样。
export function providerSettingsEnvironment(provider, backend, options) {
  const env = providerRuntimeEnvironment(provider, backend, options);
  return {
    ANTHROPIC_AUTH_TOKEN: "",
    ...Object.fromEntries(
      Object.entries(env).filter(
        ([key]) =>
          key.startsWith("ANTHROPIC_") ||
          [
            "CLAUDE_CODE_MODEL_CAPABILITIES",
            "CLAUDE_CODE_MAX_CONTEXT_TOKENS",
            "CLAUDE_CODE_EFFORT_LEVEL",
          ].includes(key),
      ),
    ),
  };
}
