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
