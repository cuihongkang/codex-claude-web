import assert from "node:assert/strict";
import { test } from "node:test";
import { annotationMessage } from "../src/annotations.js";
import {
  fileReferenceInput,
  parseUserMessage,
  userMessageText,
} from "../src/user-message.js";

test("目录引用与批注从传输正文恢复为独立数据", () => {
  const file = {
    name: "global_planner",
    path: "/fixture/global_planner",
    directory: true,
  };
  const annotations = [
    { text: "原文", annotation: "请补充", source: { messageId: "reply" } },
  ];
  const input = [
    {
      type: "text",
      text: annotationMessage(annotations, "检查 @global_planner 的约束。"),
    },
    fileReferenceInput(file),
    { type: "localImage", path: "/fixture/image.png" },
  ];
  assert.deepEqual(parseUserMessage(input), {
    text: "检查 @global_planner 的约束。",
    annotations,
    references: [file],
    attachments: [input[2]],
  });
  assert.equal(
    userMessageText(input),
    "检查 @global_planner 的约束。\n注释 1：请补充",
  );
  assert.equal(userMessageText([fileReferenceInput(file)]), "@global_planner");
});

test("合并历史正文与桌面端文件封装保留实际请求", () => {
  const file = {
    name: "planner.js",
    path: "/fixture/planner.js",
    directory: false,
  };
  const request = "检查 @planner.js";
  for (const text of [
    request + "\n" + fileReferenceInput(file).text,
    "\n# Files mentioned by the user:\n\n## planner.js: /fixture/planner.js\n\n## My request for Codex:\n" +
      request,
  ]) {
    assert.deepEqual(parseUserMessage([{ type: "text", text }]), {
      text: request,
      annotations: [],
      references: [file],
      attachments: [],
    });
  }
});

test("普通路径、协议示例和损坏封装保留可读正文", () => {
  for (const text of [
    "请读取 /fixture/planner.js。",
    "解释这段示例：\n引用本机文件：/fixture/planner.js\n请根据任务按需读取。\n示例结束。",
    "# Files mentioned by the user:\ninvalid\n\n## My request:\n保留内容",
    "# Response annotations:\n<response-annotations>broken</response-annotations>",
  ])
    assert.equal(parseUserMessage([{ type: "text", text }]).text, text);
});
