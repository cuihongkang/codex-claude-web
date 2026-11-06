import { query } from "@anthropic-ai/claude-agent-sdk";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { basename, resolve } from "node:path";
import {
  providerRuntimeEnvironment,
  providerSettingsEnvironment,
} from "./provider-environment.mjs";
import { claudeAccountIdentity } from "./account.mjs";

export function modelRecord(model, providerId = "") {
  return {
    id: model.value,
    model: model.value,
    providerId,
    displayName: model.displayName || model.value,
    description: model.description || "",
    resolvedModel: model.resolvedModel,
    supportedReasoningEfforts: (model.supportedEffortLevels || []).map(
      (reasoningEffort) => ({ reasoningEffort, description: reasoningEffort }),
    ),
    defaultReasoningEffort: "",
    supportsAdaptiveThinking: model.supportsAdaptiveThinking === true,
    serviceTiers: model.supportsFastMode
      ? [{ id: "fast", name: "Fast", description: "" }]
      : [],
  };
}

export function createClaudeCatalogue({
  backend,
  providers,
  queries = new Map(),
}) {
  const pending = new Map();
  const owned = new Map();
  function dispose(key) {
    const entry = owned.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.release?.();
    entry.query.close();
    owned.delete(key);
  }
  async function read({ cwd, providerId, threadId } = {}) {
    if (!cwd) throw new Error("读取 Claude Code 目录需要当前工作目录");
    const directory = resolve(cwd);
    const provider = await providers.get(backend.id, providerId);
    const key = JSON.stringify([directory, provider || null, threadId || ""]);
    if (pending.has(key)) return pending.get(key);
    const request = collect(directory, provider, key, threadId).finally(() =>
      pending.delete(key),
    );
    pending.set(key, request);
    return request;
  }
  async function acquire(cwd, provider, key, threadId) {
    const env = providerRuntimeEnvironment(provider, backend);
    const candidates = threadId
      ? [queries.get(threadId)].filter(Boolean)
      : [...queries.values()];
    const live = candidates.find(
      (run) =>
        run.cwd === cwd && (run.providerId || "") === (provider?.id || ""),
    );
    if (live) dispose(key);
    let release;
    const existing = owned.get(key);
    const native =
      live?.query ||
      existing?.query ||
      query({
        prompt: (async function* () {
          await new Promise((resolve) => {
            release = resolve;
          });
        })(),
        options: {
          cwd,
          env,
          pathToClaudeCodeExecutable: backend.executable,
          settingSources: ["user", "project", "local"],
          persistSession: false,
          spawnClaudeCodeProcess: (options) =>
            spawn(options.command, [...(backend.args || []), ...options.args], {
              cwd: options.cwd,
              env: options.env,
              signal: options.signal,
              stdio: ["pipe", "pipe", "pipe"],
            }),
        },
      });
    if (!live) {
      clearTimeout(existing?.timer);
      const timer = setTimeout(() => dispose(key), 5 * 60 * 1000);
      timer.unref();
      owned.set(key, {
        query: native,
        release: existing?.release || (() => release?.()),
        timer,
      });
    }
    await native.initializationResult();
    if (!live && !existing && provider) {
      try {
        await native.applyFlagSettings({
          env: providerSettingsEnvironment(provider, backend),
        });
      } catch (error) {
        dispose(key);
        throw error;
      }
    }
    if (!live && !existing)
      await native.request({ subtype: "file_suggestions", query: "" });
    return { native, live, env };
  }
  async function collect(cwd, provider, key, threadId) {
    const { native, live, env } = await acquire(cwd, provider, key, threadId);
    try {
      const [initialization, models, commands, agents, mcp, pluginsResult] =
        await Promise.all([
          native.initializationResult(),
          native
            .request({ subtype: "list_models" })
            .then(({ response }) => response.models),
          native.supportedCommands(),
          native.supportedAgents(),
          native.mcpServerStatus(),
          promisify(execFile)(
            backend.executable,
            [...(backend.args || []), "plugin", "list", "--json"],
            { cwd, env, timeout: 30000, maxBuffer: 4 * 1024 * 1024 },
          ),
        ]);
      const plugins = JSON.parse(pluginsResult.stdout);
      if (!Array.isArray(plugins))
        throw new Error("Claude Code 插件目录格式无效");
      const records = provider
        ? provider.models.map((value) => {
            const metadata =
              (provider.protocol || "messages") === "anthropic"
                ? models.find(
                    (model) =>
                      model.value === value || model.resolvedModel === value,
                  )
                : provider.modelCapabilities?.[value];
            return modelRecord(
              metadata ? { ...metadata, value } : { value },
              provider.id,
            );
          })
        : claudeAccountIdentity(initialization.account || {})
          ? models.map((model) => modelRecord(model))
          : [];
      return {
        cwd,
        providerId: provider?.id || "",
        models: records,
        commands: commands.filter(
          (command) => !(live?.terminalCommands || []).includes(command.name),
        ),
        terminalCommands: live?.terminalCommands || [],
        agents,
        account: initialization.account,
        mcp: mcp.map(({ config: _config, tools, ...server }) => ({
          ...server,
          tools: Object.fromEntries(
            (tools || []).map((tool) => [tool.name, tool]),
          ),
        })),
        plugins: plugins.map((plugin) => ({
          ...plugin,
          id: plugin.id || plugin.name,
          name: plugin.name || plugin.id,
          enabled: plugin.enabled === true,
        })),
      };
    } catch (error) {
      if (!live) dispose(key);
      throw error;
    }
  }
  async function nativeFor({ cwd, providerId, threadId }) {
    if (!cwd) throw new Error("Claude Code 查询需要当前工作目录");
    const directory = resolve(cwd);
    const provider = await providers.get(backend.id, providerId);
    const key = JSON.stringify([directory, provider || null, threadId || ""]);
    return (await acquire(directory, provider, key, threadId)).native;
  }
  async function fileSuggestions({ cwd, providerId, threadId, query: text }) {
    if (!cwd) throw new Error("文件建议需要当前工作目录");
    if (typeof text !== "string") throw new Error("文件建议查询必须是文本");
    const directory = resolve(cwd);
    const provider = await providers.get(backend.id, providerId);
    const key = JSON.stringify([directory, provider || null, threadId || ""]);
    const { native } = await acquire(directory, provider, key, threadId);
    const { response } = await native.request({
      subtype: "file_suggestions",
      query: text,
    });
    const root = response.cwd || directory;
    return {
      files: response.suggestions.map(({ path }) => ({
        root,
        path: path.endsWith("/") ? path.slice(0, -1) : path,
        file_name: basename(path),
        match_type: path.endsWith("/") ? "directory" : "file",
      })),
    };
  }
  return {
    read,
    fileSuggestions,
    async readFile(context, path) {
      const native = await nativeFor(context);
      const { response } = await native.request({
        subtype: "read_file",
        path,
        encoding: "base64",
        max_bytes: 10_000_000,
      });
      if (response.encoding !== "base64")
        throw new Error(
          "Claude Code 未返回完整二进制文件内容，请更新 Claude Code 后重试",
        );
      if (response.truncated)
        throw new Error("文件超过 Claude Code 原生读取上限（10 MB）");
      return { dataBase64: response.contents };
    },
    async settings(context) {
      return (
        await (await nativeFor(context)).request({ subtype: "get_settings" })
      ).response;
    },
    async hookListing(context) {
      return (
        await (
          await nativeFor(context)
        ).request({ subtype: "get_hooks_listing" })
      ).response;
    },
    async usage(context) {
      const native = await nativeFor(context);
      return (
        await native.request({ subtype: "get_usage", skip_behaviors: true })
      ).response;
    },
    async skills(context) {
      return (await (await nativeFor(context)).reloadSkills()).skills;
    },
    async reloadPlugins(context) {
      return (await nativeFor(context)).reloadPlugins();
    },
    close() {
      for (const key of owned.keys()) dispose(key);
    },
  };
}
