import test from "node:test";
import assert from "node:assert/strict";
import {
  referenceThreads,
  threadReferenceInput,
} from "../src/domain/composer-references.js";

test("会话引用限定后端并排除当前会话", () => {
  const threads = [
    { id: "one", name: "方案" },
    { id: "two", name: "方案二" },
    { id: "backend:claude:three", name: "方案" },
  ];
  assert.deepEqual(
    referenceThreads(threads, "codex", "one", "方案").map((t) => t.id),
    ["two"],
  );
  assert.deepEqual(
    referenceThreads(threads, "claude", null, "方案").map((t) => t.id),
    ["backend:claude:three"],
  );
});

test("引用正文保留用户和助手顺序且省去内部思考", () => {
  const input = threadReferenceInput({ id: "one", name: "方案" }, [
    { type: "userMessage", content: [{ type: "text", text: "问题" }] },
    { type: "reasoning", text: "内部" },
    { type: "agentMessage", text: "结果" },
  ]);
  assert.match(input.text, /用户：问题\n\n助手：结果/);
  assert.equal(input.text.includes("内部"), false);
});
