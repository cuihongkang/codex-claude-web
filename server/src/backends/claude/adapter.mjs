import { createClaudeAccount } from "./account.mjs";
import { configuredTokenUsage } from "./token-usage.mjs";
import { createClaudeCatalogue } from "./catalogue.mjs";
import { createClaudeSessions } from "./sessions.mjs";
import { createFileOperations } from "../../bridge/file-operations.mjs";
import { join } from "node:path";
import { claudeCapabilities } from "../../../../shared/backend-capabilities.mjs";
import { createStorage } from "../storage.mjs";
import { createSessionReader, page } from "./history.mjs";
import { createClaudeRuntime } from "./runtime.mjs";
import { createCompactions } from "../../compaction.mjs";
import { createProjectModels } from "../../project-models.mjs";
import {
  prepareProjectlessDirectory,
  readProjectlessDirectories,
} from "../../thread-projects.mjs";
import { createWorkspace } from "../../workspace/service.mjs";

export function createClaudeAdapter({
  backend,
  config,
  send,
  broadcast,
  providers,
  workspace: sharedWorkspace,
}) {
  const storage = createStorage(
    join(backend.stateDir, "claudex-web-index.json"),
    {
      sessions: {},
    },
  );
  const readSession = createSessionReader(backend);
  const questions = new Map();
  const compactions = createCompactions(broadcast);
  const projectModels = createProjectModels(backend.stateDir);
  const workspace = sharedWorkspace || createWorkspace({ broadcast });
  const runtime = createClaudeRuntime({
    backend,
    storage,
    providers,
    broadcast,
    compactions,
    questions,
  });
  const catalogue = createClaudeCatalogue({
    backend,
    providers,
    queries: runtime.queries,
  });
  const account = createClaudeAccount({
    backend,
    providers,
    catalogue,
    queries: runtime.queries,
  });
  const files = createFileOperations({
    call: dispatch,
    activeTurns: runtime.running,
    activeThreads: runtime.running,
    broadcast,
  });
  let ready = false,
    version = "",
    error = null;
  const notify = (method, params) => broadcast({ method, params });
  function state() {
    return {
      method: "lan/state",
      params: {
        ready,
        runtimeVersion: version,
        error,
        questions: [...questions.values()].map((q) => q.question),
        internalCommands: [...runtime.queries]
          .filter(([, process]) => process.commands.busy)
          .map(([id]) => id),
        activeTurns: Object.fromEntries(
          [...runtime.running]
            .filter(([, r]) => r.turn)
            .map(([id, r]) => [id, r.turn.id]),
        ),
        executionStatuses: Object.fromEntries(
          [...runtime.running]
            .filter(([, run]) => run.status)
            .map(([id, run]) => [id, run.status]),
        ),
        compactions: Object.fromEntries(compactions.entries),
        terminals: sharedWorkspace ? {} : workspace.snapshot(),
        undoneFiles: [...files.undoneFiles.values()],
      },
    };
  }
  const assertReady = () => {
    if (!ready) throw new Error(error || "Claude Code 尚未就绪");
  };
  const sessions = createClaudeSessions({
    config,
    storage,
    readSession,
    runtime,
    compactions,
    notify,
    assertReady,
    readTokenUsage: async (session) =>
      configuredTokenUsage(
        session,
        (await providers.list(backend.id)).find(
          (provider) => provider.id === session.providerId,
        ),
      ),
  });
  const { session, update } = sessions;
  async function dispatch(method, p) {
    if (sessions.handles(method)) return sessions.request(method, p);
    if (method === "fuzzyFileSearch") {
      const context = p.threadId ? await session(p.threadId) : p;
      const results = await Promise.all(
        (p.roots || [context.cwd || config.defaultCwd]).map((cwd) =>
          catalogue.fileSuggestions({
            cwd,
            query: p.query,
            providerId: p.providerId ?? context.providerId ?? "",
            threadId: p.threadId,
          }),
        ),
      );
      return { files: results.flatMap((result) => result.files) };
    }
    const handler =
      runtime.goals.handlers.get(method) || runtime.tasks.handlers.get(method);
    if (handler) return handler(p);
    if (method === "review/start") {
      if (p.target?.type !== "uncommittedChanges")
        throw new Error("请选择未提交的项目变更");
      if (!ready) throw new Error(error || "Claude Code 尚未就绪");
      if (runtime.running.has(p.threadId) || compactions.busy(p.threadId))
        throw new Error("请等待当前任务结束后审查代码");
      return runtime.enqueue(p.threadId, {
        input: [
          {
            type: "text",
            text: "/code-review 当前项目所有未提交的变更，包含暂存、未暂存和未跟踪文件。读取项目约定及相关实现，检查正确性、回归、安全和测试缺口。按严重程度列出可核查的问题、文件位置、触发条件和修复建议；没有发现问题时明确说明。仅进行审查，保持项目文件不变。",
          },
        ],
        review: true,
      });
    }
    if (method === "lan/projectModels/read")
      return { projects: await projectModels.read() };
    if (method === "lan/projectModels/set")
      return { projects: await projectModels.set(p) };
    if (method === "lan/projectless/read")
      return { directories: await readProjectlessDirectories(backend.dataDir) };
    if (method === "lan/projectless/prepare")
      return {
        cwd: await prepareProjectlessDirectory(config.projectlessRoot),
        root: config.projectlessRoot,
      };
    if (method === "fs/readFile") {
      const context = p.threadId ? await session(p.threadId) : p;
      return catalogue.readFile(
        {
          cwd: context.cwd || config.defaultCwd,
          providerId: p.providerId ?? context.providerId ?? "",
          threadId: p.threadId,
        },
        p.path,
      );
    }
    if (workspace.handles(method)) return workspace.request(method, p);
    if (["account/read", "account/rateLimits/read"].includes(method)) {
      const context = p.threadId ? await session(p.threadId) : p;
      const params = {
        ...p,
        cwd: context.cwd || config.defaultCwd,
        providerId: p.providerId ?? context.providerId ?? "",
      };
      return method === "account/read"
        ? account.read(params)
        : account.rateLimits(params);
    }
    if (method === "config/read") {
      const context = p.threadId ? await session(p.threadId) : p;
      const settings = await catalogue.settings({
        cwd: context.cwd || config.defaultCwd,
        providerId: p.providerId ?? context.providerId ?? "",
        threadId: p.threadId,
      });
      return {
        config: {
          model: settings.applied.model,
          model_reasoning_effort: settings.applied.effort,
        },
      };
    }
    if (
      [
        "model/list",
        "mcpServerStatus/list",
        "plugin/installed",
        "skills/list",
      ].includes(method)
    ) {
      const context = p.threadId ? await session(p.threadId) : p;
      const cwd = context.cwd || config.defaultCwd;
      const data = await catalogue.read({
        cwd,
        providerId: p.providerId ?? context.providerId ?? "",
        threadId: p.threadId,
      });
      if (method === "model/list")
        return { data: data.models, nextCursor: null };
      if (method === "mcpServerStatus/list") return page(data.mcp, p);
      if (method === "plugin/installed")
        return {
          marketplaces: [{ name: "Claude Code", plugins: data.plugins }],
        };
      const directories = await Promise.all(
        (p.cwds || [cwd]).map(async (directory) => ({
          cwd: directory,
          skills: (
            await catalogue.skills({
              cwd: directory,
              providerId: p.providerId ?? context.providerId ?? "",
              threadId: p.threadId,
            })
          ).map((skill) => ({ ...skill, native: true })),
        })),
      );
      return {
        commands: [
          ...data.commands,
          ...directories
            .flatMap((entry) => entry.skills)
            .filter(
              (skill) =>
                !data.commands.some((command) => command.name === skill.name),
            ),
        ],
        agents: data.agents,
        data: directories,
      };
    }
    if (
      method === "turn/start" ||
      method === "turn/steer" ||
      method === "thread/compact/start"
    ) {
      if (!ready) throw new Error(error || "Claude Code 尚未就绪");
      if (files.undoing.has(p.threadId))
        throw new Error("正在撤销文件修改，请稍候");
      if (method === "turn/steer") return runtime.steer(p.threadId, p);
      const result = await runtime.enqueue(
        p.threadId,
        p,
        method === "thread/compact/start",
      );
      return method === "turn/start" ? result : {};
    }
    if (method === "turn/interrupt") return runtime.interrupt(p.threadId);
    if (method === "lan/compaction/check")
      return { compaction: compactions.entries.get(p.threadId) || null };
    if (method === "lan/inputQueue/list")
      return { entries: (await session(p.threadId)).queue || [] };
    if (method === "lan/inputQueue/retry") {
      const s = await session(p.threadId);
      if (!s.queue?.some((q) => q.id === p.id))
        throw new Error("排队输入已结束");
      await update(p.threadId, {
        queue: s.queue.map((q) =>
          q.id === p.id ? { ...q, status: "queued" } : q,
        ),
      });
      runtime.resumeQueue(p.threadId);
      return {};
    }
    if (method === "lan/inputQueue/cancel") {
      await storage.update((data) => ({
        ...data,
        sessions: {
          ...data.sessions,
          [p.threadId]: {
            ...data.sessions[p.threadId],
            queue: data.sessions[p.threadId].queue.filter((q) => q.id !== p.id),
          },
        },
      }));
      notify("lan/inputQueue/updated", { threadId: p.threadId });
      return {};
    }
    if (method === "lan/files/undo") return files.undo(p);
    throw new Error(`Claude Code 暂不支持此操作：${method}`);
  }
  return {
    capabilities: claudeCapabilities,
    state,
    subscriptions: new Map(),
    releaseUnusedThreads() {
      runtime
        .releaseUnusedThreads()
        .catch((error) => console.error("Claude Code 空闲会话释放失败", error));
    },
    get ready() {
      return ready;
    },
    async connect() {
      try {
        version = await runtime.check();
        await runtime.recover();
        for (const [id, s] of Object.entries((await storage.read()).sessions))
          if (s.compaction) {
            const entry = ["starting", "running"].includes(s.compaction.status)
              ? {
                  ...s.compaction,
                  status: "interrupted",
                  completedAt: Date.now() / 1000,
                }
              : s.compaction;
            compactions.entries.set(id, entry);
          }
        ready = true;
      } catch (e) {
        error = e.message;
      }
      broadcast(state());
    },
    async receive(client, message) {
      if (!message.method) {
        const q = questions.get(String(message.id));
        if (q) {
          questions.delete(String(message.id));
          const answers = Object.fromEntries(
            q.input.questions.map((question, i) => [
              question.question,
              (message.result?.answers?.[String(i)]?.answers || []).join(", "),
            ]),
          );
          q.resolve(
            message.error
              ? { behavior: "deny", message: message.error.message }
              : { behavior: "allow", updatedInput: { ...q.input, answers } },
          );
          notify("serverRequest/resolved", { requestId: message.id });
        }
        return;
      }
      try {
        send(client, {
          id: message.id,
          result: await dispatch(message.method, message.params || {}),
        });
      } catch (e) {
        send(client, {
          id: message.id,
          error: { code: -32000, message: e.message },
        });
      }
    },
    close() {
      ready = false;
      account.close();
      catalogue.close();
      runtime.close();
      if (!sharedWorkspace) workspace.close();
    },
  };
}
