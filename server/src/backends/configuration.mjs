import { resolve, join } from "node:path";
import { createStorage } from "./storage.mjs";
import { validateNetworkProxy } from "./network-proxy.mjs";

export function validateBackend(input, config) {
  if (!["codex", "claude"].includes(input.id) || input.id !== input.type)
    throw new Error("仅支持 Codex 与 Claude Code 两个固定后端");
  const backend = {
    id: input.id,
    name: input.type === "codex" ? "Codex" : "Claude Code",
    type: input.type,
    enabled: input.enabled !== false,
    dataDir: resolve(
      input.type === "codex" ? config.codexHome : config.claudeHome,
    ),
    ...(input.type === "claude" && {
      stateDir: join(config.configDir, "backends", "claude"),
      ...(input.proxy !== undefined && {
        proxy: validateNetworkProxy(input.proxy),
      }),
    }),
    executable: input.type === "claude" ? "claude" : "codex",
    args: [],
  };
  if (input.type === "codex") {
    const url = new URL(config.upstreamUrl);
    if (!["ws:", "wss:"].includes(url.protocol) || url.username || url.password)
      throw new Error("请填写 WebSocket 服务地址");
    if (
      url.protocol === "ws:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
      throw new Error("跨主机后端必须使用 WSS");
    backend.url = url.href;
    if (
      input.hiddenModels !== undefined &&
      (!Array.isArray(input.hiddenModels) ||
        input.hiddenModels.some((id) => typeof id !== "string" || !id.trim()))
    )
      throw new Error("隐藏模型列表无效");
    backend.hiddenModels = [...new Set(input.hiddenModels || [])];
  }
  return backend;
}

export function createBackendConfiguration(config) {
  const storage = createStorage(
    config.backendsFile || join(config.configDir, "backends.json"),
    {
      version: 1,
      backends: [
        {
          id: "codex",
          name: "Codex",
          type: "codex",
          enabled: true,
          url: config.upstreamUrl,
          dataDir: config.codexHome,
          executable: "codex",
          args: [],
        },
        {
          id: "claude",
          name: "Claude Code",
          type: "claude",
          enabled: false,
          dataDir: config.claudeHome,
          stateDir: join(config.configDir, "backends", "claude"),
          executable: "claude",
          args: [],
        },
      ],
      providers: [],
    },
  );
  async function save(input) {
    const previous = (await storage.read()).backends.find(
      (b) => b.id === input.id,
    );
    const backend = validateBackend({ ...previous, ...input }, config);
    await storage.update((data) => ({
      ...data,
      backends: [...data.backends.filter((b) => b.id !== backend.id), backend],
    }));
    return backend;
  }
  async function read() {
    const data = await storage.read();
    const ids = new Set();
    for (const backend of data.backends) {
      if (
        !["codex", "claude"].includes(backend.id) ||
        backend.type !== backend.id ||
        ids.has(backend.id)
      )
        throw new Error("配置仅支持一个 Codex 和一个 Claude Code 后端");
      ids.add(backend.id);
    }
    return {
      ...data,
      backends: ["codex", "claude"].map((id) =>
        validateBackend(
          {
            ...data.backends.find((b) => b.id === id),
            id,
            type: id,
            enabled: data.backends.find((b) => b.id === id)?.enabled ?? false,
          },
          config,
        ),
      ),
    };
  }
  return {
    ...storage,
    read,
    save,
    async readProviders() {
      return (await storage.read()).providers;
    },
  };
}
