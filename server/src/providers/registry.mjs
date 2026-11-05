import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createProviderStorage } from "./storage.mjs";
import { createAdapterSettings } from "./adapter-settings.mjs";
import { createContextStorage } from "./context-storage.mjs";
import {
  createCodexProviderConfig,
  configuredDefinition,
} from "./codex-config.mjs";

export function createProviderRegistry(codexHome, adapterPort) {
  const native = createCodexProviderConfig();
  const adapter = createAdapterSettings(codexHome, adapterPort);
  const context = createContextStorage(codexHome);
  const storage = createProviderStorage(
    join(codexHome, "codex-web", "providers.json"),
  );
  const builtin = {
    id: "codex",
    name: "ChatGPT",
    builtin: true,
    models: [],
  };
  async function list() {
    const config = await native.read();
    const metadata = (await storage.read()).providers;
    const providers = Object.entries(config.model_providers || {})
      .filter(([id]) => id !== "openai")
      .map(([id, info]) => {
        const saved = metadata.find((p) => p.id === id);
        const chat =
          saved?.protocol === "chat" && info.base_url === adapter.url(id);
        return {
          id,
          name: info.name || id,
          baseUrl: (chat ? saved.baseUrl : info.base_url) || "",
          protocol: chat ? "chat" : "responses",
          models: metadata.find((p) => p.id === id)?.models || [],
          hasApiKey: Boolean(
            chat
              ? saved.apiKey
              : info.experimental_bearer_token || info.env_key || info.auth,
          ),
        };
      });
    const missing = metadata.filter(
      (p) => !providers.some((n) => n.id === p.id),
    );
    return [
      builtin,
      ...providers,
      ...missing.map(({ apiKey, ...p }) => ({
        ...p,
        requiresMigration: true,
        hasApiKey: Boolean(apiKey),
      })),
    ];
  }
  async function get(id) {
    if (id === "codex") return builtin;
    const provider = (await list()).find((p) => p.id === id);
    if (!provider) throw new Error("供应商已移除，请重新选择供应商。");
    if (provider.requiresMigration)
      throw new Error("请在供应商设置中保存此供应商，将配置同步到 Codex。");
    if (provider.protocol === "chat") {
      let response;
      try {
        response = await fetch(new URL("/healthz", adapter.url(id)), {
          headers: { Authorization: "Bearer " + (await adapter.token()) },
          signal: AbortSignal.timeout(2000),
        });
      } catch {
        throw new Error(
          "Chat 模型转换服务未启动，请运行 codex-web adapter 或启动 codex-model-adapter.service。",
        );
      }
      if (!response.ok)
        throw new Error(
          "Chat 模型转换服务凭据无效，请核对网页与转换程序使用的 CODEX_HOME。",
        );
    }
    return provider;
  }
  async function set(input) {
    const id = input.id || randomUUID();
    if (["codex", "openai"].includes(id) || !/^[a-zA-Z0-9_-]{1,80}$/.test(id))
      throw new Error("供应商标识无效");
    const url = new URL(input.baseUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("请填写 HTTP 或 HTTPS API 地址");
    if (!input.name?.trim()) throw new Error("请填写供应商名称");
    if (!["responses", "chat"].includes(input.protocol))
      throw new Error("请选择 Responses 或 Chat Completions 接口。");
    if (!Array.isArray(input.models) || !input.models.length)
      throw new Error("请至少添加一个模型");
    const models = input.models.map((model) => {
      if (
        !model.id?.trim() ||
        !Number.isInteger(model.contextWindow) ||
        model.contextWindow < 4096 ||
        !Number.isInteger(model.maxOutputTokens) ||
        model.maxOutputTokens < 1 ||
        model.maxOutputTokens >= model.contextWindow
      )
        throw new Error("请填写模型标识、上下文窗口和有效的最大输出长度");
      return {
        id: model.id.trim(),
        contextWindow: model.contextWindow,
        maxOutputTokens: model.maxOutputTokens,
      };
    });
    if (new Set(models.map((m) => m.id)).size !== models.length)
      throw new Error("模型标识重复");
    const config = await native.read();
    const previous = config.model_providers?.[id] || {};
    const legacy = (await storage.read()).providers.find((p) => p.id === id);
    const definition = {
      ...configuredDefinition(previous),
      name: input.name.trim(),
      base_url: url.href.replace(/\/$/, ""),
      wire_api: "responses",
    };
    if (input.protocol === "chat") {
      delete definition.env_key;
      delete definition.auth;
      definition.base_url = adapter.url(id);
      definition.experimental_bearer_token = await adapter.token();
      definition.requires_openai_auth = false;
      definition.supports_websockets = false;
      definition.capabilities = { remote_compaction: "unsupported" };
    } else if (
      input.apiKey !== undefined ||
      legacy?.protocol === "chat" ||
      (!config.model_providers?.[id] && legacy?.apiKey)
    ) {
      delete definition.env_key;
      delete definition.auth;
      delete definition.experimental_bearer_token;
      const apiKey =
        input.apiKey === undefined ? legacy?.apiKey : String(input.apiKey);
      if (apiKey) definition.experimental_bearer_token = apiKey;
    }
    await native.write(id, definition);
    await storage.update((data) => {
      return {
        ...data,
        providers: [
          ...data.providers.filter((p) => p.id !== id),
          {
            id,
            name: definition.name,
            models,
            ...(input.protocol === "chat" && {
              protocol: "chat",
              baseUrl: url.href.replace(/\/$/, ""),
              apiKey:
                input.apiKey === undefined
                  ? legacy?.apiKey || ""
                  : String(input.apiKey),
            }),
          },
        ],
      };
    });
    return list();
  }
  async function remove(id) {
    const config = await native.read();
    if (["codex", "openai", config.model_provider].includes(id))
      throw new Error(
        "当前默认供应商由 Codex 管理，请先在 Codex 中切换默认配置。",
      );
    if (config.model_providers?.[id]) await native.write(id, null);
    await storage.update((data) => {
      return { ...data, providers: data.providers.filter((p) => p.id !== id) };
    });
    return list();
  }
  return {
    connect: native.connect,
    saveContext: context.save,
    removeContext: context.remove,
    readConfig: native.read,
    list,
    get,
    set,
    remove,
    async resolveId(id) {
      if (id === "codex_web_default") return "codex";
      const metadata = (await storage.read()).providers;
      return (
        metadata.find(
          (p) => "codex_web_" + Buffer.from(p.id).toString("hex") === id,
        )?.id || id
      );
    },
    async selection(threadId) {
      return (await storage.read()).threads[threadId];
    },
    async remember(threadId, selection) {
      await storage.update((data) => ({
        ...data,
        threads: { ...data.threads, [threadId]: selection },
      }));
    },
    async discover(id) {
      const provider = await get(id);
      const config = await native.read();
      const info = config.model_providers?.[id];
      const saved = (await storage.read()).providers.find((p) => p.id === id);
      const apiKey =
        provider.protocol === "chat"
          ? saved.apiKey
          : info?.experimental_bearer_token ||
            (info?.env_key && process.env[info.env_key]);
      if (info?.env_key && !apiKey)
        throw new Error(
          "此供应商的认证由 Codex 环境提供，请手动填写模型标识。",
        );
      const response = await fetch(provider.baseUrl + "/models", {
        headers: apiKey ? { Authorization: "Bearer " + apiKey } : {},
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok)
        throw new Error("读取模型列表失败：HTTP " + response.status);
      return { models: (await response.json()).data.map((m) => m.id) };
    },
  };
}
