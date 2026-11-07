import assert from "node:assert/strict";
import test from "node:test";
import { compatibleEffort } from "../src/domain/model-preferences.js";

const model = (values, fallback = "medium") => ({
  defaultReasoningEffort: fallback,
  supportedReasoningEfforts: values.map((reasoningEffort) => ({
    reasoningEffort,
  })),
});

test("切换模型保留受支持的强度，缺失档位取最近值，等距取较低档", () => {
  assert.equal(compatibleEffort("high", model(["low", "high"], "low")), "high");
  assert.equal(
    compatibleEffort("xhigh", model(["none", "high", "ultra"], "none")),
    "high",
  );
  assert.equal(compatibleEffort("medium", model(["high", "low"])), "low");
  assert.equal(compatibleEffort("ultra", model(["low", "high"])), "high");
  assert.equal(compatibleEffort("none", model(["medium", "high"])), "medium");
  assert.equal(compatibleEffort("high", model(["ultra"], "ultra")), "ultra");
});

test("初次选择使用模型默认值，未提供档位列表时保留已有强度", () => {
  assert.equal(compatibleEffort("", model(["low", "high"], "high")), "high");
  assert.equal(
    compatibleEffort("high", { defaultReasoningEffort: "low" }),
    "high",
  );
  assert.equal(compatibleEffort("high", undefined), "high");
});

test("明确为空的强度列表清理旧选择，缺失列表继续保留历史偏好", () => {
  assert.equal(compatibleEffort("high", { supportedReasoningEfforts: [] }), "");
  assert.equal(compatibleEffort("high", undefined), "high");
});

test("项目偏好按当前模型目录校验，失效配置及空目录清除旧选择", async (t) => {
  const { createModelPreferences } =
    await import("../src/application/models.js");
  const original = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: () =>
      JSON.stringify({ "/demo": { model: "old-vendor", effort: "max" } }),
  };
  t.after(() => {
    globalThis.localStorage = original;
  });
  const preferences = createModelPreferences({
    get: () => ({ backendId: "claude" }),
  });
  const models = [
    { model: "first", supportedReasoningEfforts: [] },
    { model: "default", isDefault: true, supportedReasoningEfforts: [] },
  ];
  assert.deepEqual(
    preferences.projectModelSelection(
      "/demo",
      false,
      { model: "first" },
      models,
    ),
    { model: "first", effort: "" },
  );
  assert.equal(
    preferences.projectModelSelection(
      "/demo",
      false,
      { model: "missing" },
      models,
    ).model,
    "default",
  );
  assert.equal(
    preferences.projectModelSelection("/demo", false, {}, models.slice(0, 1))
      .model,
    "first",
  );
  assert.deepEqual(
    preferences.projectModelSelection(
      "/demo",
      false,
      { model: "missing", effort: "high" },
      [],
    ),
    { model: "", effort: "" },
  );
  assert.equal(
    preferences.projectModelSelection("/demo", false, {}, [
      { model: "old-vendor" },
    ]).model,
    "old-vendor",
  );
});
