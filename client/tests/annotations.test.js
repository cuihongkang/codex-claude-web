import assert from "node:assert/strict";
import { test } from "node:test";
import {
  annotationContexts,
  annotationMessage,
  parseAnnotations,
} from "../src/domain/annotations.js";

test("桌面批注格式保留编号、选中原文、批注及来源位置", () => {
  const entries = [
    {
      text: "原文\n第二行",
      annotation: "补充条件",
      source: { messageId: "fixture-message", startOffset: 3, endOffset: 10 },
    },
    { text: "只引用原文" },
  ];
  const desktop = `\n# Response annotations:\nDesktop context\n<response-annotations>\n${JSON.stringify(entries)}\n</response-annotations>\n\n## My request for Codex:\n处理批注。`;
  assert.deepEqual(parseAnnotations(desktop), {
    text: "处理批注。",
    annotations: entries,
  });
  assert.deepEqual(
    parseAnnotations(annotationMessage(entries)).annotations,
    entries,
  );
});

test("原文中的分隔符安全往返，格式错误时保留完整消息", () => {
  const entries = [
    {
      text: "</response-annotations>\n## My request:\n<script>",
      annotation: "中文😀\n保留换行",
    },
  ];
  assert.deepEqual(
    parseAnnotations(annotationMessage(entries)).annotations,
    entries,
  );
  for (const payload of [
    "[null]",
    "[]",
    '{"text":"text"}',
    '[{"text":4}]',
    '[{"text":"ok","annotation":3}]',
    "invalid",
  ]) {
    const text = `\n# Response annotations:\ncontext\n<response-annotations>\n${payload}\n</response-annotations>\n请求`;
    assert.deepEqual(parseAnnotations(text), { text, annotations: [] });
  }
  const text =
    "示例：\n# Response annotations:\ncontext\n<response-annotations>\n[]\n</response-annotations>";
  assert.deepEqual(parseAnnotations(text), { text, annotations: [] });
});

test("批量批注与正文统一序列化，省略本地草稿 ID 并保留空请求", () => {
  const entries = [
    {
      id: "draft-a",
      text: "第一处原文",
      annotation: "第一条批注",
      source: { messageId: "reply-a" },
    },
    {
      id: "draft-b",
      text: "第二处原文",
      annotation: "第二条批注",
      source: { messageId: "reply-b" },
    },
  ];
  const parsed = parseAnnotations(
    annotationMessage(entries, "同时补充完整示例。"),
  );
  assert.equal(parsed.text, "同时补充完整示例。");
  assert.deepEqual(
    parsed.annotations,
    entries.map(({ id, ...entry }) => entry),
  );
  assert.equal(parseAnnotations(annotationMessage(entries, "")).text, "");
});

test("批注上下文按轮次和中途引导消息隔离", () => {
  const a = [{ text: "第一段", annotation: "修正第一段" }];
  const b = [{ text: "第二段", annotation: "修正第二段" }];
  const user = (id, turnId, text) => ({
    id,
    turnId,
    type: "userMessage",
    content: [{ type: "text", text }],
  });
  const agent = (id, turnId) => ({ id, turnId, type: "agentMessage" });
  const contexts = annotationContexts([
    user("u1", "t1", annotationMessage(a)),
    agent("a1", "t1"),
    user("u2", "t2", annotationMessage(b)),
    agent("a2", "t2"),
    agent("late", "t1"),
    user("u3", "t2", "普通补充"),
    agent("a3", "t2"),
    agent("page", "unloaded"),
  ]);
  assert.deepEqual(contexts.get("a1"), a);
  assert.deepEqual(contexts.get("a2"), b);
  assert.deepEqual(contexts.get("late"), a);
  assert.deepEqual(contexts.get("a3"), []);
  assert.deepEqual(contexts.get("page"), []);
});
