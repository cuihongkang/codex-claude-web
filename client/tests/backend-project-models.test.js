import test from "node:test";
import assert from "node:assert/strict";
import { createModelPreferences } from "../src/application/models.js";
import { createBackends } from "../src/application/backends.js";

test("激活后端保留原生默认强度并恢复项目设置同步，跨后端保存分别结算", async (t) => {
  const original = globalThis.localStorage;
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  t.after(() => {
    globalThis.localStorage = original;
  });
  let state = {
    backends: ["codex", "claude"].map((id) => ({
      id,
      type: id,
      enabled: true,
    })),
    backendId: "codex",
    providerId: "",
    cwd: "/demo",
    current: null,
    connected: true,
    model: "",
    effort: "",
    draft: "",
    attachments: [],
    models: [],
    modelChoices: [],
    active: {},
  };
  const get = () => state;
  const set = (patch) => {
    state = { ...state, ...patch };
  };
  const transport = { connection: {} };
  const projects = { codex: {}, claude: {} };
  const writes = [];
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let hold = false;
  const rpc = async (method, params = {}) => {
    const id = params.backendId || state.backendId;
    if (method === "lan/providers/list") return { providers: [] };
    if (method === "model/list")
      return {
        data: [
          {
            id,
            model: id + "-model",
            isDefault: true,
            supportedReasoningEfforts: [
              { reasoningEffort: "low" },
              { reasoningEffort: "high" },
            ],
          },
        ],
      };
    if (method === "config/read")
      return {
        config: {
          model: id + "-model",
          model_reasoning_effort: "high",
          service_tier: "priority",
        },
      };
    if (method === "account/read") return { account: null };
    if (method === "lan/projectModels/read")
      return { projects: { ...projects[id] } };
    if (method === "lan/projectModels/set") {
      writes.push(id);
      if (hold && id === "codex") await held;
      projects[id][params.cwd] = { model: params.model, effort: params.effort };
      return { projects: { ...projects[id] } };
    }
    throw new Error(method);
  };
  const errors = [];
  const models = createModelPreferences({
    get,
    set,
    rpc,
    transport,
    report: (e) => errors.push(e),
  });
  const backends = createBackends({
    get,
    set,
    rpc,
    models,
    report: (e) => errors.push(e),
  });
  await backends.activateBackend("codex");
  assert.deepEqual(models.defaults, { model: "codex-model", effort: "high" });
  assert.equal(state.serviceTier, "priority");
  hold = true;
  models.selectEffort("low");
  await Promise.resolve();
  await backends.activateBackend("claude");
  models.selectEffort("high");
  await models.syncProjectModels();
  assert.deepEqual(projects.claude["/demo"], {
    model: "claude-model",
    effort: "high",
  });
  assert.deepEqual(writes, ["codex", "claude"]);
  release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(state.backendId, "claude");
  assert.equal(state.model, "claude-model");
  assert.equal(state.effort, "high");
  assert.equal(
    JSON.parse(storage.get("cx-project-models-claude"))["/demo"].model,
    "claude-model",
  );
  assert.deepEqual(errors, []);
});

test("新草稿初始化先恢复供应商，再按所属后端读取模型、账户与项目偏好", async (t) => {
  const original = globalThis.localStorage;
  const storage = new Map([["cx-provider-claude", JSON.stringify("vendor")]]);
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  t.after(() => {
    globalThis.localStorage = original;
  });
  let state = {
    connected: true,
    backendId: "claude",
    providerId: "",
    cwd: "/demo",
    projectless: false,
    current: null,
    model: "",
    effort: "",
    draft: "保留草稿",
    attachments: [],
    models: [],
    modelChoices: [],
    providers: [],
    active: {},
    backends: [{ id: "claude", type: "claude", enabled: true }],
  };
  const calls = [];
  const rpc = async (method, params = {}) => {
    calls.push({ method, params });
    if (method === "lan/providers/list")
      return {
        providers: [{ id: "vendor", name: "Vendor", models: ["vendor-model"] }],
      };
    if (method === "model/list")
      return {
        data: [
          {
            id: "vendor-model",
            model: "vendor-model",
            supportedReasoningEfforts: [{ reasoningEffort: "high" }],
          },
        ],
      };
    if (method === "config/read")
      return {
        config: { model: "vendor-model", model_reasoning_effort: "high" },
      };
    if (method === "account/read")
      return { account: { type: "provider", name: params.providerId } };
    if (method === "lan/projectModels/read")
      return {
        projects: { "/demo": { model: "vendor-model", effort: "high" } },
      };
    throw new Error(method);
  };
  const get = () => state,
    set = (patch) => {
      state = { ...state, ...patch };
    };
  const transport = { connection: {} };
  const models = createModelPreferences({
    get,
    set,
    rpc,
    transport,
    report: (e) => {
      throw e;
    },
  });
  await createBackends({
    get,
    set,
    rpc,
    transport,
    models,
    report: (e) => {
      throw e;
    },
  }).activateBackend("claude");
  assert.equal(
    calls.find((c) => c.method === "account/read").params.providerId,
    "vendor",
  );
  assert.equal(state.providerId, "vendor");
  assert.equal(state.account.name, "vendor");
  assert.equal(state.model, "vendor-model");
  assert.equal(state.effort, "high");
  assert.equal(state.draft, "保留草稿");
});
