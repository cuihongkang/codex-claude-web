import test from "node:test";
import assert from "node:assert/strict";
import {
  reasoningContent,
  reasoningSummaries,
} from "../src/domain/reasoning-summary.js";
import { conversationGroups } from "../src/domain/conversation-groups.js";

test("空摘要和空标题不生成思考行", () => {
  assert.deepEqual(reasoningSummaries(), []);
  assert.deepEqual(reasoningSummaries(["", " \n ", { text: "" }, "** **"]), []);
});

test("流式推理正文保持完整段落，进入工作过程并保留摘要展示规则", () => {
  const content = [
    "First paragraph.",
    "",
    { text: "Second paragraph.\nContinuation." },
  ];
  assert.equal(
    reasoningContent(content),
    "First paragraph.\n\nSecond paragraph.\nContinuation.",
  );
  const groups = conversationGroups([
    { id: "raw", turnId: "turn", type: "reasoning", summary: [], content },
  ]);
  assert.equal(groups[0].items[0].id, "raw");
  assert.deepEqual(
    conversationGroups([{ id: "empty", type: "reasoning", content: [" "] }]),
    [],
  );
});
test("加粗标题直接作为标签，正文独立折叠", () => {
  assert.deepEqual(
    reasoningSummaries(["**检查当前分支**\n\n读取 Git 状态。"]),
    [{ title: "检查当前分支", body: "读取 Git 状态。" }],
  );
});
test("只有标题时正文为空，不生成展开内容", () => {
  for (const text of ["**确认配置**", "## 确认配置", "确认配置"])
    assert.deepEqual(reasoningSummaries([text]), [
      { title: "确认配置", body: "" },
    ]);
});
test("多段摘要保留各自标题和正文，跳过空段落", () => {
  assert.deepEqual(
    reasoningSummaries([
      "",
      { text: "### 分析原因\n\n第一段\n\n第二段" },
      "**验证修改**",
    ]),
    [
      { title: "分析原因", body: "第一段\n\n第二段" },
      { title: "验证修改", body: "" },
    ],
  );
});
