// 供应商定义与凭据由 Codex 配置持有；网页只维护模型选项和显示偏好。
export function createCodexProviderConfig() {
  let call;
  return {
    connect(invoke) {
      call = invoke;
    },
    async read() {
      if (!call) throw new Error("请先连接 Codex 后读取供应商配置。");
      const { config } = await call("config/read", { includeLayers: false });
      return config || {};
    },
    async write(id, definition) {
      if (!call) throw new Error("请先连接 Codex 后修改供应商配置。");
      const result = await call("config/value/write", {
        keyPath: "model_providers." + id,
        value: definition,
        mergeStrategy: "replace",
      });
      if (result.status !== "ok")
        throw new Error(
          "供应商配置被其他 Codex 配置层覆盖，请检查实际生效配置。",
        );
    },
  };
}

export function configuredDefinition(value) {
  if (Array.isArray(value)) return value.map(configuredDefinition);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== null && entry !== undefined)
      .map(([key, entry]) => [key, configuredDefinition(entry)]),
  );
}

export function publicCodexConfig(config) {
  if (!config?.model_providers) return config;
  return {
    ...config,
    model_providers: Object.fromEntries(
      Object.entries(config.model_providers).map(([id, info]) => [
        id,
        {
          name: info.name,
          base_url: info.base_url,
          wire_api: info.wire_api,
          requires_openai_auth: info.requires_openai_auth,
          supports_websockets: info.supports_websockets,
          capabilities: info.capabilities,
        },
      ]),
    ),
  };
}
