import test from "node:test";
import assert from "node:assert/strict";
import { messageNavigationEntries } from "../src/message-navigation.js";
import { conversationGroups } from "../src/conversation-groups.js";
import { annotationMessage } from "../src/annotations.js";

const user = (id, text, turnId = "turn") => ({
  id,
  type: "userMessage",
  turnId,
  content: [{ type: "text", text }],
});

test("目录包含跨轮次提问和中途补充，已收纳的问题回答沿用过程布局", () => {
  const items = [
    user("first", "第一条\n 多行问题"),
    {
      id: "question",
      type: "agentMessage",
      turnId: "turn",
      questions: [{ title: "选择主题", options: ["浅色", "深色"] }],
    },
    user("response", "选择主题\n回答：深色"),
    user("steer", "再补充键盘操作"),
    { id: "answer", type: "agentMessage", turnId: "turn", text: "完成" },
    user("second", "下个任务", "next-turn"),
  ];
  assert.deepEqual(messageNavigationEntries(conversationGroups(items)), [
    { id: "first", number: 1, label: "第一条 多行问题" },
    { id: "steer", number: 2, label: "再补充键盘操作" },
    { id: "second", number: 3, label: "下个任务" },
  ]);
});

test("图片、技能与批注消息具有可读标题，多段文字合并", () => {
  const items = [
    {
      ...user("image", ""),
      content: [{ type: "localImage", path: "/fixture/image.png" }],
    },
    { ...user("skill", ""), content: [{ type: "skill", name: "review" }] },
    user(
      "annotation",
      annotationMessage([{ text: "较早的回答", annotation: "补充适用条件" }]),
    ),
    {
      ...user("multipart", ""),
      content: [
        { type: "text", text: "第一部分" },
        { type: "image", url: "data:image/png;base64,fixture" },
        { type: "text", text: "第二部分" },
      ],
    },
    { ...user("empty", ""), content: [] },
  ];
  const entries = messageNavigationEntries(conversationGroups(items));
  assert.deepEqual(
    entries.map((entry) => entry.label),
    [
      "图片附件",
      "技能：review",
      "请根据这些注释继续处理。 注释 1：补充适用条件",
      "第一部分 第二部分",
      "消息",
    ],
  );
  assert(!entries[2].label.includes("response-annotations"));
  assert.deepEqual(messageNavigationEntries([]), []);
});
