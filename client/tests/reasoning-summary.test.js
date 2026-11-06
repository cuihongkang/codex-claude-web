import test from "node:test";
import assert from "node:assert/strict";
import {
  reasoningSummaries,
  appendReasoningSummary,
} from "../src/domain/reasoning-summary.js";

test("完整思考保留单行长正文和段落，并以独立标题展开", () => {
  const body = "这是完整思考正文。".repeat(80) + "\n\n第二段。";
  let summary = appendReasoningSummary([], 0, body.slice(0, 100), "思考");
  summary = appendReasoningSummary(summary, 0, body.slice(100));
  assert.deepEqual(reasoningSummaries(summary), [{ title: "思考", body }]);
  assert.deepEqual(appendReasoningSummary(["标题"], 0, "正文"), ["标题正文"]);
});

test("空摘要和空标题不生成思考行", () => {
  assert.deepEqual(reasoningSummaries(), []);
  assert.deepEqual(reasoningSummaries(["", " \n ", { text: "" }, "** **"]), []);
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
