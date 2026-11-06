import { resolve, join } from "node:path";
import { createStorage } from "./storage.mjs";

export function validateBackend(input, config) {
  if (!["codex", "claude"].includes(input.id) || input.id !== input.type)
    throw new Error("仅支持 Codex 与 Claude Code 两个固定后端");
  const backend = {
    id: input.id,
    name: input.type === "codex" ? "Codex" : "Claude Code",
    type: input.type,
    enabled: input.enabled !== false,
    dataDir: resolve(
      input.dataDir ||
        (input.type === "codex" ? config.codexHome : config.claudeHome),
    ),
    ...(input.type === "claude" && {
      stateDir: join(config.configDir, "backends", "claude"),
    }),
    executable:
      input.executable?.trim() ||
      (input.type === "claude" ? "claude" : "codex"),
    args: input.args || [],
  };
  if (
    !Array.isArray(backend.args) ||
    backend.args.some((arg) => typeof arg !== "string")
  )
    throw new Error("启动参数必须是字符串数组");
  if (input.type === "codex") {
    const url = new URL(input.url || config.upstreamUrl);
    if (!["ws:", "wss:"].includes(url.protocol) || url.username || url.password)
      throw new Error("请填写 WebSocket 服务地址");
    if (
      url.protocol === "ws:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
      throw new Error("跨主机后端必须使用 WSS");
    backend.url = url.href;
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
    const backend = validateBackend(input, config);
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
      backends: ["codex", "claude"].map((id) => ({
        id,
        type: id,
        enabled: false,
        executable: id,
        args: [],
        dataDir: id === "codex" ? config.codexHome : config.claudeHome,
        ...(id === "codex" && { url: config.upstreamUrl }),
        ...data.backends.find((b) => b.id === id),
        ...(id === "claude" && {
          stateDir: join(config.configDir, "backends", "claude"),
        }),
        name: id === "codex" ? "Codex" : "Claude Code",
      })),
    };
  }
  return { ...storage, read, save };
}
