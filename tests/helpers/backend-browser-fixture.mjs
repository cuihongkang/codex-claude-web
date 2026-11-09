export function backendFixture(data) {
  localStorage.clear();
  localStorage.setItem("cx-current", "legacy");
  localStorage.setItem("cx-theme", JSON.stringify("light"));
  const threads = [
    {
      id: "legacy",
      name: "旧版未分类与 Markdown",
      cwd: "/native/claudex-web/workspaces/chat-ABC123",
      originator: "claudex_web",
      createdAt: 3,
    },
    {
      id: "desktop",
      name: "客户端未分类",
      cwd: "/documents/Codex/2026-11-06/notes",
      createdAt: 2,
    },
    {
      id: "backend:claude:fixture",
      name: "Claude 原生消息归属",
      cwd: "/demo/project",
      model: "sonnet",
      createdAt: 1,
    },
  ];
  const messages = {
    legacy: [
      {
        id: "markdown-user",
        type: "userMessage",
        turnId: "legacy-turn",
        content: [
          { type: "text", text: data.markdown },
          {
            type: "text",
            text: "引用本机文件：/demo/notes.md\n请根据任务按需读取。",
          },
        ],
      },
    ],
    "backend:claude:fixture": data.claudeItems,
  };
  const backends = ["codex", "claude"].map((id) => ({
    id,
    type: id,
    name: id === "codex" ? "Codex" : "Claude Code",
    enabled: true,
    ready: true,
    installation: data.backendInstallations?.[id],
  }));
  let providers =
    data.providers ||
    (data.providerModelNames
      ? [
          {
            id: "vendor",
            backendId: "claude",
            name: "示例供应商",
            baseUrl: "https://example.org",
            models: [
              "provider/team/very-long-custom-model-identifier-for-alias-testing",
            ],
            modelAliases: {},
          },
        ]
      : []);
  const backendIdOf = (id) =>
    id?.startsWith("backend:") ? id.split(":")[1] : "codex";
  const state = () => ({
    ready: backends.some((backend) => backend.ready),
    bridgeReady: true,
    backends,
    defaultBackendId:
      backends.find((backend) => backend.enabled)?.id || "codex",
    defaultCwd: "/demo/project",
    projectlessRoot: data.main
      ? "/native/claudex-web/workspaces"
      : "/web/workspaces",
    projectlessRoots: ["/web/workspaces", "/native/claudex-web/workspaces"],
    activeTurns: {},
    executionStatuses: {},
    compactions: {},
    undoneFiles: [],
    questions: [],
    terminals: {},
  });
  window.fixtureRequests = [];
  window.WebSocket = class {
    static OPEN = 1;
    readyState = 1;
    constructor() {
      window.backendSocket = this;
      setTimeout(
        () =>
          this.onmessage({
            data: JSON.stringify({ method: "lan/state", params: state() }),
          }),
        0,
      );
    }
    send(raw) {
      const m = JSON.parse(raw),
        p = m.params || {};
      window.fixtureRequests.push(m);
      const thread = threads.find((t) => t.id === p.threadId);
      let result = { data: [] };
      if (m.method === "lan/backends/list") result = { backends };
      if (m.method === "lan/backends/save") {
        const backend = backends.find((b) => b.id === p.id);
        Object.assign(backend, p);
        if (Object.hasOwn(p, "enabled")) backend.ready = p.enabled;
        this.emit("lan/state", state());
        result = { backends };
      }
      if (m.method === "lan/backends/versions") {
        this.emit("lan/state", state());
        result = { backends };
      }
      if (m.method === "lan/backends/install") {
        const backend = backends.find((b) => b.id === p.id);
        backend.installation = {
          installed: true,
          currentVersion: "2.1.318",
          latestVersion: "2.1.318",
          installing: false,
        };
        this.emit("lan/state", state());
        result = { backends };
      }
      if (m.method === "thread/list")
        result = {
          data: threads.filter((thread) =>
            backends.some(
              (backend) =>
                backend.enabled && backend.id === backendIdOf(thread.id),
            ),
          ),
        };
      if (m.method === "lan/projectless/read")
        result = { directories: { desktop: threads[1].cwd } };
      if (m.method === "lan/providers/list")
        result = {
          providers: providers.filter(
            (provider) => p.includeDisabled || provider.enabled !== false,
          ),
        };
      if (m.method === "lan/providers/remove") {
        providers = providers.filter((provider) => provider.id !== p.id);
        result = { providers };
      }
      if (m.method === "lan/providers/save") {
        const previous = providers.find((provider) => provider.id === p.id);
        providers = [
          {
            ...previous,
            ...p,
            ...(previous?.preset && {
              enabled: Boolean(p.apiKey?.trim()),
              hasApiKey: Boolean(p.apiKey?.trim()),
            }),
          },
          ...providers.filter((provider) => provider.id !== p.id),
        ];
        result = { providers };
      }
      if (m.method === "model/list")
        result = {
          data: [
            {
              id: p.backendId === "claude" ? "sonnet" : "gpt",
              model: p.backendId === "claude" ? "sonnet" : "gpt",
              isDefault: true,
              supportedReasoningEfforts: [
                { reasoningEffort: "low" },
                { reasoningEffort: "high" },
              ],
              defaultReasoningEffort: "high",
            },
          ],
        };
      if (m.method === "model/list")
        result.data.push({
          id: "second",
          model: "second",
          displayName: "Second Model",
          supportedReasoningEfforts: [
            { reasoningEffort: "low" },
            { reasoningEffort: "high" },
          ],
          defaultReasoningEffort: "high",
        });
      if (
        (data.providerModelNames || data.providers) &&
        m.method === "model/list" &&
        providers.some((provider) => provider.id === p.providerId)
      ) {
        const provider = providers.find(
          (provider) => provider.id === p.providerId,
        );
        result = {
          data: provider.models.map((model) => ({
            id: model,
            model,
            displayName: provider.modelAliases?.[model] || model,
            supportedReasoningEfforts: [],
          })),
        };
      }
      if (m.method === "fs/readDirectory")
        result = {
          entries: [{ fileName: "notes.md", isFile: true, isDirectory: false }],
        };
      if (m.method === "fs/readFile")
        result = { dataBase64: btoa("# Notes\n\nFile reference fixture.") };
      if (m.method === "config/read") result = { config: {} };
      if (m.method === "account/read") result = { account: null };
      if (m.method.startsWith("lan/projectModels/")) result = { projects: {} };
      if (["thread/read", "thread/resume"].includes(m.method))
        result = { thread, cwd: thread.cwd, model: thread.model || "gpt" };
      if (m.method === "thread/items/list")
        result = {
          data: (messages[p.threadId] || []).toReversed().map((item) => ({
            turnId: item.turnId,
            item,
          })),
        };
      if (m.method === "thread/turns/list")
        result = {
          data: [
            {
              id: p.threadId === "legacy" ? "legacy-turn" : "human",
              status: "completed",
              startedAt: 1,
              completedAt: 2,
              items: messages[p.threadId] || [],
            },
          ],
        };
      if (m.method === "skills/list")
        result = {
          data: [
            {
              cwd: p.cwd,
              skills: [
                {
                  name: "测试技能",
                  description: "交互对照技能",
                  path: "/demo/skill/SKILL.md",
                },
              ],
            },
          ],
        };
      setTimeout(
        () => this.onmessage({ data: JSON.stringify({ id: m.id, result }) }),
        0,
      );
    }
    setBackendReady(id, ready) {
      backends.find((backend) => backend.id === id).ready = ready;
      this.emit("lan/state", state());
    }
    emit(method, params) {
      this.onmessage({ data: JSON.stringify({ method, params }) });
    }
    close() {
      this.readyState = 3;
    }
  };
}
