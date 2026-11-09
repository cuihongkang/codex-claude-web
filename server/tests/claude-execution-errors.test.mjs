import test from "node:test";
import assert from "node:assert/strict";
import { executionError } from "../src/backends/claude/execution-errors.mjs";

test("API failures expose a concise status and retain the original diagnostic", () => {
  const raw = 'API Error: 400 {"error":{"message":"invalid parameter"}}';
  const error = executionError(new Error(raw));
  assert.equal(error.code, "providerRequest");
  assert.match(error.message, /HTTP 400/);
  assert.ok(!error.message.includes("invalid parameter"));
  assert.equal(error.details, raw);
});

test("ordinary execution errors preserve their actionable message", () => {
  assert.equal(
    executionError(new Error("项目指令读取失败")).message,
    "项目指令读取失败",
  );
});
