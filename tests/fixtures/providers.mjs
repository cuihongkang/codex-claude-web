export function providerFixture() {
  window.providerRequests = [];
  const storageKey = "provider-fixture-settings";
  const providers = JSON.parse(localStorage.getItem(storageKey) || "null") || [
    { id: "codex", name: "ChatGPT / Codex", builtin: true, models: [] },
    {
      id: "open-model",
      name: "第三方供应商 A",
      baseUrl: "https://models.example.com/v1",
      protocol: "chat",
      hasApiKey: true,
      models: [
        { id: "shared-model", contextWindow: 32768, maxOutputTokens: 4096 },
      ],
    },
  ];
  const model = {
    id: "shared-model",
    model: "shared-model",
    displayName: "演示模型",
    isDefault: true,
    supportedReasoningEfforts: [{ reasoningEffort: "high" }],
    defaultReasoningEffort: "high",
  };
  const thread = {
    id: "provider-demo",
    name: "跨供应商继续任务",
    cwd: "/demo/Workspace",
    createdAt: 1,
    model: model.model,
    providerId: localStorage.getItem("provider-fixture-current") || "codex",
    modelProvider: "openai",
    status: { type: "idle" },
  };
  localStorage.setItem("cx-current", thread.id);
  localStorage.setItem("cx-projects", JSON.stringify([thread.cwd]));
  window.WebSocket = class {
    static OPEN = 1;
    readyState = 1;
    constructor() {
      window.providerSocket = this;
      setTimeout(() => {
        this.onopen?.();
        this.emit("lan/state", {
          ready: true,
          providers: true,
          projectModels: true,
          defaultCwd: thread.cwd,
          questions: [],
          activeTurns: {},
          compactions: {},
          terminals: {},
        });
      }, 30);
    }
    emit(method, params) {
      this.onmessage?.({ data: JSON.stringify({ method, params }) });
    }
    send(raw) {
      const m = JSON.parse(raw);
      window.providerRequests.push(m);
      let result = {};
      if (m.method === "model/list") result = { data: [model] };
      if (m.method === "account/read")
        result = {
          account: {
            type: "chatgpt",
            email: "demo@example.com",
            planType: "plus",
          },
        };
      if (m.method === "config/read")
        result = { config: { model: model.model } };
      if (m.method === "lan/providers/read") result = { providers };
      if (m.method === "lan/providers/set") {
        const { apiKey, ...provider } = m.params;
        Object.assign(provider, {
          id: provider.id || "added",
          hasApiKey: Boolean(apiKey) || Boolean(provider.hasApiKey),
        });
        const previous = providers.findIndex((p) => p.id === provider.id);
        if (previous >= 0) providers[previous] = provider;
        else providers.push(provider);
        localStorage.setItem(storageKey, JSON.stringify(providers));
        result = { providers };
      }
      if (m.method === "lan/providers/remove") {
        const index = providers.findIndex((p) => p.id === m.params.id);
        if (index >= 0) providers.splice(index, 1);
        localStorage.setItem(storageKey, JSON.stringify(providers));
        result = { providers };
      }
      if (
        m.method === "lan/projectModels/read" ||
        m.method === "lan/projectModels/set"
      )
        result = { projects: {} };
      if (m.method === "thread/list")
        result = { data: [thread], nextCursor: null };
      if (m.method === "thread/read" || m.method === "thread/resume")
        result = { thread, model: model.model, cwd: thread.cwd };
      if (m.method === "thread/items/list")
        result = { data: [], nextCursor: null };
      if (m.method === "thread/turns/list" || m.method === "skills/list")
        result = { data: [], nextCursor: null };
      if (m.method === "turn/start") {
        thread.providerId = m.params.providerId;
        localStorage.setItem("provider-fixture-current", thread.providerId);
        result = { turn: { id: "demo-turn", status: "completed" } };
      }
      setTimeout(
        () => this.onmessage?.({ data: JSON.stringify({ id: m.id, result }) }),
        5,
      );
    }
    close() {}
  };
}
