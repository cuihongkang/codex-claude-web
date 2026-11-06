import { randomUUID } from "node:crypto";

export function createProviders(configuration) {
  const publicProvider = ({ apiKey, ...provider }) => ({
    ...provider,
    hasApiKey: Boolean(apiKey),
  });
  async function list(backendId) {
    const data = await configuration.read();
    return data.providers
      .filter(
        (p) =>
          p.backendId === "claude" && (!backendId || p.backendId === backendId),
      )
      .map(publicProvider);
  }
  async function get(backendId, providerId) {
    const providers = (await configuration.read()).providers.filter(
      (p) => p.backendId === backendId,
    );
    if (providerId == null || providerId === "") return null;
    const provider = providers.find((p) => p.id === providerId);
    if (!provider) throw new Error("供应商已移除，请重新选择");
    return provider;
  }
  async function save(input) {
    if (input.backendId !== "claude")
      throw new Error("供应商配置仅用于 Claude Code");
    const id = input.id || randomUUID();
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error("供应商标识无效");
    const url = new URL(input.baseUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("请填写有效的 API 地址");
    if (!input.name?.trim()) throw new Error("请填写供应商名称");
    const protocol = input.protocol || "messages";
    if (!["messages", "anthropic"].includes(protocol))
      throw new Error("请选择支持的 API 协议");
    const models = (input.models || []).map((m) =>
      typeof m === "string" ? m.trim() : m.id?.trim(),
    );
    if (
      !models.length ||
      models.some((m) => !m) ||
      new Set(models).size !== models.length
    )
      throw new Error("请填写不重复的模型标识");
    const modelCapabilities = input.modelCapabilities || {};
    for (const [model, metadata] of Object.entries(modelCapabilities)) {
      if (
        !models.includes(model) ||
        !Array.isArray(metadata.supportedEffortLevels) ||
        metadata.supportedEffortLevels.some(
          (level) => !["low", "medium", "high", "xhigh", "max"].includes(level),
        ) ||
        (metadata.contextWindow !== undefined &&
          (!Number.isSafeInteger(metadata.contextWindow) ||
            metadata.contextWindow <= 0)) ||
        [metadata.supportsFastMode, metadata.supportsAdaptiveThinking].some(
          (value) => value !== undefined && typeof value !== "boolean",
        )
      )
        throw new Error("模型参数配置无效");
    }
    await configuration.update((data) => {
      const backend = data.backends.find((b) => b.id === input.backendId);
      if (!backend) throw new Error("后端不存在");
      const previous = data.providers.find((p) => p.id === id);
      if (previous && previous.backendId !== input.backendId)
        throw new Error("供应商所属后端不可更改");
      const provider = {
        id,
        backendId: backend.id,
        name: input.name.trim(),
        protocol,
        baseUrl: url.href.replace(/\/$/, ""),
        models,
        modelCapabilities:
          input.modelCapabilities === undefined
            ? Object.fromEntries(
                Object.entries(previous?.modelCapabilities || {}).filter(
                  ([model]) => models.includes(model),
                ),
              )
            : modelCapabilities,
        apiKey:
          input.apiKey === undefined
            ? previous?.apiKey || ""
            : String(input.apiKey),
      };
      return {
        ...data,
        providers: [...data.providers.filter((p) => p.id !== id), provider],
      };
    });
    return list(input.backendId);
  }
  async function remove({ id }) {
    await configuration.update((data) => ({
      ...data,
      providers: data.providers.filter((p) => p.id !== id),
    }));
    return list();
  }
  return { list, get, save, remove };
}
