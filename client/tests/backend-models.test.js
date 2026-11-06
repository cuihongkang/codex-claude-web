import assert from "node:assert/strict";
import test from "node:test";
import { createBackends } from "../src/application/backends.js";

test("统一模型选择按供应商路由，跨后端选择保留草稿和附件，已有对话保持所属后端", async (t) => {
  const saved = new Map();
  const original = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
  };
  t.after(() => {
    globalThis.localStorage = original;
  });
  const attachment = { type: "image", url: "data:image/png;base64,AA==" };
  let state = {
    backends: [
      { id: "codex", type: "codex", enabled: true },
      { id: "claude", type: "claude", enabled: true },
    ],
    backendId: "codex",
    current: null,
    draft: "保留这段输入",
    attachments: [attachment],
    active: {},
  };
  const set = (patch) => {
    state = { ...state, ...patch };
  };
  const providers = ["one", "two"].map((id) => ({
    id,
    name: id,
    models: ["same-model"],
  }));
  const controller = createBackends({
    get: () => state,
    set,
    report: (error) => {
      throw error;
    },
    rpc: async (method, params) =>
      method === "lan/providers/list"
        ? { providers }
        : method === "model/list"
          ? {
              data: [
                {
                  id: params.backendId === "claude" ? "same-model" : "gpt",
                  model: params.backendId === "claude" ? "same-model" : "gpt",
                },
              ],
            }
          : { account: null },
    models: {
      disconnect() {},
      configure() {},
      selectModel: (choice) => set({ model: choice.model }),
    },
  });
  await controller.activateBackend("codex");
  assert.equal(
    state.modelChoices.find(
      (choice) => choice.backendId === "claude" && choice.providerId === "",
    ).providerName,
    "Claude",
  );
  const choice = state.modelChoices.find(
    (choice) => choice.providerId === "two",
  );
  await controller.selectModelChoice(choice);
  assert.equal(state.backendId, "claude");
  assert.equal(state.providerId, "two");
  assert.equal(state.model, "same-model");
  assert.equal(state.draft, "保留这段输入");
  assert.equal(state.attachments[0], attachment);
  assert.equal(saved.get("cx-draft-new-claude"), "保留这段输入");
  set({ current: { id: "backend:claude:session" } });
  await controller.selectModelChoice(
    state.modelChoices.find((choice) => choice.backendId === "codex"),
  );
  assert.equal(state.backendId, "claude");
  await controller.selectModelChoice(
    state.modelChoices.find((choice) => choice.providerId === "one"),
  );
  assert.equal(state.providerId, "one");
  assert.equal(state.current.id, "backend:claude:session");
  set({
    backendId: "codex",
    current: { id: "native-session" },
    model: "gpt-existing",
    effort: "high",
    providerId: "",
    serviceTier: "fast",
  });
  const refreshing = controller.activateBackend("codex");
  assert.equal(state.model, "gpt-existing");
  set({ model: "gpt-manual", effort: "xhigh" });
  await refreshing;
  assert.equal(state.model, "gpt-manual");
  assert.equal(state.effort, "xhigh");
  assert.equal(state.serviceTier, "fast");
});

test("跨后端模型选择同步保留完整供应商快照，立即发送及迟到目录读取保持同一归属", async (t) => {
  const original = globalThis.localStorage,
    saved = new Map();
  globalThis.localStorage = {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
  };
  t.after(() => {
    globalThis.localStorage = original;
  });
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const choice = {
    backendId: "claude",
    providerId: "chosen",
    providerName: "Chosen",
    id: "same",
    model: "same",
    supportedReasoningEfforts: [{ reasoningEffort: "high" }],
  };
  let state = {
    backends: [
      { id: "codex", type: "codex", enabled: true },
      { id: "claude", type: "claude", enabled: true },
    ],
    backendId: "codex",
    current: null,
    model: "gpt",
    providerId: "",
    effort: "high",
    draft: "立即发送",
    attachments: [],
    active: {},
    cwd: "/workspace",
    modelChoices: [choice],
    models: [],
  };
  const set = (patch) => {
    state = { ...state, ...patch };
  };
  const controller = createBackends({
    get: () => state,
    set,
    report: (e) => {
      throw e;
    },
    models: {
      disconnect() {},
      configure() {},
      selectModel: (model) => set({ model: model.model, effort: "high" }),
    },
    rpc: async (method, params) => {
      if (method === "lan/providers/list")
        return {
          providers: [
            { id: "other", name: "Other", models: ["same"] },
            { id: "chosen", name: "Chosen", models: ["same"] },
          ],
        };
      if (method === "model/list") {
        await gate;
        return {
          data: [
            {
              id:
                params.backendId === "codex"
                  ? "gpt"
                  : params.providerId
                    ? "same"
                    : "sonnet",
              model:
                params.backendId === "codex"
                  ? "gpt"
                  : params.providerId
                    ? "same"
                    : "sonnet",
            },
          ],
        };
      }
      return { account: null };
    },
  });
  const switching = controller.selectModelChoice(choice);
  assert.equal(state.backendId, "claude");
  assert.equal(state.providerId, "chosen");
  assert.equal(state.model, "same");
  assert.equal(state.draft, "立即发送");
  const firstRequest = {
    backendId: state.backendId,
    providerId: state.providerId,
    model: state.model,
  };
  set({
    current: { id: "backend:claude:immediate" },
    active: { "backend:claude:immediate": "turn" },
  });
  release();
  await switching;
  assert.deepEqual(firstRequest, {
    backendId: "claude",
    providerId: "chosen",
    model: "same",
  });
  assert.equal(state.providerId, "chosen");
  assert.equal(state.model, "same");
  assert.equal(state.effort, "high");
  assert(
    state.modelChoices.some(
      (model) =>
        model.backendId === "claude" &&
        model.providerId === "" &&
        model.model === "sonnet",
    ),
  );
  set({ active: {} });
  await controller.selectModelChoice(
    state.modelChoices.find(
      (model) => model.backendId === "claude" && model.providerId === "",
    ),
  );
  assert.equal(state.providerId, "");
  assert.equal(state.model, "sonnet");
  assert.equal(state.current.id, "backend:claude:immediate");
});

test("供应商切换清理旧账户，目录恢复期间的新选择隔离迟到账户结果", async (t) => {
  const original = globalThis.localStorage,
    storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  t.after(() => {
    globalThis.localStorage = original;
  });
  const choices = ["a", "b"].map((providerId) => ({
    backendId: "claude",
    providerId,
    id: providerId,
    model: "model-" + providerId,
  }));
  let state = {
    backendId: "claude",
    providerId: "a",
    model: "model-a",
    modelChoices: choices,
    models: [choices[0]],
    providers: [],
    current: { id: "backend:claude:thread" },
    backends: [{ id: "claude", type: "claude", enabled: true }],
    active: {},
    draft: "preserved",
    attachments: [],
    cwd: "/project",
    account: { name: "A" },
    usage: { rateLimits: { primary: { usedPercent: 90 } } },
  };
  const set = (patch) => {
    state = { ...state, ...patch };
  };
  let resolveOld;
  const oldAccount = new Promise((resolve) => {
    resolveOld = resolve;
  });
  const changes = [];
  const controller = createBackends({
    get: () => state,
    set,
    report: (error) => {
      throw error;
    },
    onSelectionChanged: () => {
      changes.push({
        providerId: state.providerId,
        model: state.model,
        account: state.account,
        usage: state.usage,
      });
      set({ account: { name: "B" } });
    },
    models: {
      disconnect() {},
      configure() {},
      selectModel: (choice) => set({ model: choice.model }),
    },
    rpc: async (method, params) => {
      if (method === "account/read") return oldAccount;
      if (method === "lan/providers/list")
        return {
          providers: [
            { id: "a", name: "A", models: ["model-a"] },
            { id: "b", name: "B", models: ["model-b"] },
          ],
        };
      if (method === "model/list")
        return {
          data: [
            {
              id: params.providerId || "native",
              model: params.providerId
                ? "model-" + params.providerId
                : "sonnet",
            },
          ],
        };
      return {};
    },
  });
  const restoring = controller.activateBackend("claude");
  await controller.selectModelChoice(choices[1]);
  assert.equal(state.providerId, "b");
  assert.equal(state.model, "model-b");
  assert.deepEqual(changes, [
    { providerId: "b", model: "model-b", account: null, usage: null },
  ]);
  resolveOld({ account: { name: "A-late" } });
  await restoring;
  assert.equal(state.account.name, "B");
  assert.equal(state.providerId, "b");
  assert.equal(state.draft, "preserved");
});

test("供应商模型目录刷新按实际档位校准强度与速度，移除能力后清理旧参数", async (t) => {
  const original = globalThis.localStorage,
    storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  t.after(() => {
    globalThis.localStorage = original;
  });
  let record = {
    id: "model",
    model: "model",
    supportedReasoningEfforts: [
      { reasoningEffort: "low" },
      { reasoningEffort: "medium" },
    ],
    serviceTiers: [{ id: "fast" }],
  };
  let state = {
    backendId: "claude",
    providerId: "vendor",
    model: "model",
    effort: "high",
    serviceTier: "priority",
    current: { id: "backend:claude:thread" },
    backends: [{ id: "claude", type: "claude", enabled: true }],
    modelChoices: [],
    models: [],
    providers: [],
    draft: "",
    attachments: [],
    active: {},
    cwd: "/project",
  };
  const set = (patch) => {
    state = { ...state, ...patch };
  };
  const controller = createBackends({
    get: () => state,
    set,
    report: (error) => {
      throw error;
    },
    models: { disconnect() {}, configure() {}, selectModel() {} },
    rpc: async (method) =>
      method === "lan/providers/list"
        ? { providers: [{ id: "vendor", name: "Vendor", models: ["model"] }] }
        : method === "model/list"
          ? { data: [record] }
          : { account: null },
  });
  await controller.activateBackend("claude");
  assert.equal(state.effort, "medium");
  assert.equal(state.serviceTier, "fast");
  record = { ...record, supportedReasoningEfforts: [], serviceTiers: [] };
  await controller.activateBackend("claude");
  assert.equal(state.effort, "");
  assert.equal(state.serviceTier, null);
  assert.equal(state.model, "model");
  assert.equal(state.providerId, "vendor");
});

test("同供应商切换模型保留技能目录，运行时模型选择应用于下一轮", async () => {
  const first = { backendId: "claude", providerId: "vendor", model: "first" };
  const second = { ...first, model: "second" };
  let state = {
    backendId: "claude",
    providerId: "vendor",
    current: { id: "backend:claude:thread" },
    active: { "backend:claude:thread": "running" },
    model: "first",
    skills: [{ name: "skill" }],
    nativeCommands: [{ name: "command" }],
    nativeAgents: [{ name: "agent" }],
    models: [first, second],
    providers: [],
    backends: [],
    modelChoices: [first, second],
  };
  const skills = state.skills,
    commands = state.nativeCommands;
  const controller = createBackends({
    get: () => state,
    set: (patch) => {
      state = { ...state, ...patch };
    },
    rpc() {
      throw new Error("不应重新读取");
    },
    models: {
      selectModel: (model) => {
        state.model = model.model;
      },
    },
  });
  await controller.selectModelChoice(second);
  assert.equal(state.model, "second");
  assert.equal(state.skills, skills);
  assert.equal(state.nativeCommands, commands);
  await controller.selectModelChoice({ ...second, providerId: "other" });
  assert.equal(state.providerId, "vendor");
});
