import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createProviderStorage } from "./storage.mjs";

export function createProviderRegistry(codexHome) {
  const storage = createProviderStorage(
    join(codexHome, "codex-web", "providers.json"),
  );
  const builtin = {
    id: "codex",
    name: "ChatGPT / Codex",
    builtin: true,
    models: [],
  };
  const publicProvider = ({ apiKey, ...provider }) => ({
    ...provider,
    hasApiKey: Boolean(apiKey),
  });
  async function list() {
    return [builtin, ...(await storage.read()).providers.map(publicProvider)];
  }
  async function get(id) {
    if (id === "codex") return builtin;
    const provider = (await storage.read()).providers.find((p) => p.id === id);
    if (!provider) throw new Error("供应商已移除，请重新选择供应商。");
    return provider;
  }
  async function set(input) {
    const id = input.id || randomUUID();
    if (id === "codex" || !/^[a-zA-Z0-9_-]{1,80}$/.test(id))
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
    if (!input.name?.trim() || !["responses", "chat"].includes(input.protocol))
      throw new Error("请填写供应商名称并选择接口类型");
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
    await storage.update((data) => {
      const previous = data.providers.find((p) => p.id === id);
      const provider = {
        id,
        name: input.name.trim(),
        baseUrl: url.href.replace(/\/$/, ""),
        protocol: input.protocol,
        apiKey:
          input.apiKey === undefined
            ? previous?.apiKey || ""
            : String(input.apiKey),
        models,
      };
      return {
        ...data,
        providers: [...data.providers.filter((p) => p.id !== id), provider],
      };
    });
    return list();
  }
  async function remove(id) {
    if (id === "codex") throw new Error("默认供应商由 Codex 管理");
    await storage.update((data) => {
      return { ...data, providers: data.providers.filter((p) => p.id !== id) };
    });
    return list();
  }
  return {
    list,
    get,
    set,
    remove,
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
      const response = await fetch(provider.baseUrl + "/models", {
        headers: provider.apiKey
          ? { Authorization: "Bearer " + provider.apiKey }
          : {},
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok)
        throw new Error("读取模型列表失败：HTTP " + response.status);
      return { models: (await response.json()).data.map((m) => m.id) };
    },
  };
}
