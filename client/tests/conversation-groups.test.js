import test from "node:test";
import assert from "node:assert/strict";
import { conversationGroups } from "../src/domain/conversation-groups.js";
const item = (id, type, props = {}) => ({
  id,
  type,
  turnId: "turn-1",
  ...props,
});
const user = item("user", "userMessage");
const progress = item("progress", "agentMessage", {
  phase: "commentary",
  text: "正在检查。",
});
const tool = item("tool", "commandExecution", { command: "pwd" });
const thought = item("thought", "reasoning", { summary: ["**检查结果**"] });
const answer = item("answer", "agentMessage", {
  phase: "final_answer",
  text: "检查完成。",
});
test("进度、命令与思考摘要整体合并，用户消息和最终回答保持独立", () => {
  const groups = conversationGroups([user, progress, tool, thought, answer]);
  assert.deepEqual(
    groups.map((g) => g.type),
    ["message", "process", "message"],
  );
  assert.deepEqual(
    groups[1].items.map((i) => i.id),
    ["progress", "tool", "thought"],
  );
});
test("中途引导消息独立显示，同轮过程汇总到最后一条引导下方", () => {
  const groups = conversationGroups([
    user,
    progress,
    item("steer", "userMessage"),
    tool,
    item("next-steer", "userMessage"),
    thought,
    answer,
  ]);
  assert.deepEqual(
    groups.map((g) => g.id),
    ["user", "steer", "next-steer", "process-turn-1", "answer"],
  );
  assert.deepEqual(
    groups[3].items.map((entry) => entry.id),
    ["progress", "steer", "tool", "next-steer", "thought"],
  );
});
test("生成中的引导消息立即将已有过程移到消息下方并保持分组 ID", () => {
  const before = conversationGroups([user, progress, tool]);
  const during = conversationGroups([
    user,
    progress,
    tool,
    item("pending-steer", "userMessage", { optimistic: true }),
  ]);
  assert.deepEqual(
    during.map((g) => g.id),
    ["user", "pending-steer", before[1].id],
  );
  assert.deepEqual(during[2].items.slice(0, -1), before[1].items);
  assert.equal(during[2].items.at(-1).id, "pending-steer");
});
test("每轮过程各自汇总，前一轮的引导和过程保留在该轮最终回答上方", () => {
  const groups = conversationGroups([
    user,
    progress,
    item("steer", "userMessage"),
    tool,
    answer,
    item("next-user", "userMessage", { turnId: "turn-2" }),
    { ...progress, id: "next-progress", turnId: "turn-2" },
    item("next-steer", "userMessage", { turnId: "turn-2" }),
    { ...tool, id: "next-tool", turnId: "turn-2" },
    { ...answer, id: "next-answer", turnId: "turn-2" },
  ]);
  assert.deepEqual(
    groups.map((g) => g.id),
    [
      "user",
      "steer",
      "process-turn-1",
      "answer",
      "next-user",
      "next-steer",
      "process-turn-2",
      "next-answer",
    ],
  );
  assert.deepEqual(
    groups.filter((g) => g.type === "process").map((g) => g.turnId),
    ["turn-1", "turn-2"],
  );
});
test("缺少轮次信息的历史活动保持相邻分组", () => {
  for (const turnId of [undefined, null]) {
    const groups = conversationGroups(
      [user, progress, tool, item("steer", "userMessage"), thought, answer].map(
        (entry) => ({ ...entry, turnId }),
      ),
    );
    assert.deepEqual(
      groups.map((g) => g.id),
      ["user", "process-progress", "steer", "process-thought", "answer"],
    );
  }
});
test("缺少轮次信息的活动与其他轮次的活动分别分组", () => {
  const groups = conversationGroups([
    { ...progress, turnId: undefined },
    tool,
    { ...thought, turnId: undefined },
  ]);
  assert.deepEqual(
    groups.map((g) => g.id),
    ["process-progress", "process-turn-1", "process-thought"],
  );
});
test("空摘要不创建折叠区域，只有最终回答时直接显示", () => {
  assert.deepEqual(
    conversationGroups([
      item("empty", "reasoning", { summary: [] }),
      answer,
    ]).map((g) => g.id),
    ["answer"],
  );
});
test("旧消息缺少阶段字段时，末尾回复保留为正文", () => {
  assert.deepEqual(
    conversationGroups([
      user,
      { ...progress, phase: null },
      tool,
      { ...answer, phase: null },
    ]).map((g) => g.type),
    ["message", "process", "message"],
  );
});
test("生成中的进度和工具依然位于一个折叠区域", () => {
  assert.equal(conversationGroups([progress, tool, thought]).length, 1);
});
test("异步提问保持展开，空正文和后续进度均保留问题卡片", () => {
  const question = item("question", "agentMessage", {
    phase: "commentary",
    text: "",
    questions: [{ title: "选择部署方式", options: ["源码", "npm"] }],
  });
  const groups = conversationGroups([progress, question, tool]);
  assert.deepEqual(
    groups.map((group) => group.type),
    ["process", "message"],
  );
  assert.equal(groups[1].item, question);
  assert.deepEqual(groups[0].items, [progress, tool]);
});

test("只有提问时建立稳定的过程区域，提交成功后题目与回答收入原区域", () => {
  const question = item("question", "agentMessage", {
    text: "",
    questions: [{ title: "选择部署方式", options: ["源码", "npm"] }],
  });
  const pending = conversationGroups([user, question]);
  assert.deepEqual(
    pending.map((group) => group.id),
    ["user", "process-turn-1", "question"],
  );
  const completed = conversationGroups([
    user,
    question,
    item("response", "userMessage", {
      content: [{ type: "text", text: "选择部署方式\n回答：npm" }],
    }),
    answer,
  ]);
  assert.deepEqual(
    completed.map((group) => group.id),
    ["user", pending[1].id, "answer"],
  );
  assert.deepEqual(completed[1].items[0].questionAnswers, ["npm"]);
});

test("同轮多批问题各自收纳，普通引导后过程与待答卡片保持顺序", () => {
  const question = item("question", "agentMessage", {
    text: "",
    questions: [{ title: "选择部署方式", options: ["源码", "npm"] }],
  });
  const next = {
    ...question,
    id: "next-question",
    questions: [{ title: "选择配置", options: ["保留", "覆盖"] }],
  };
  const groups = conversationGroups([
    user,
    progress,
    question,
    next,
    item("response", "userMessage", {
      content: [{ type: "text", text: "选择部署方式\n回答：npm" }],
    }),
    item("steer", "userMessage"),
    tool,
  ]);
  assert.deepEqual(
    groups.map((group) => group.id),
    ["user", "steer", "process-turn-1", "next-question"],
  );
  assert.deepEqual(
    groups[2].items.map((entry) => entry.id),
    ["progress", "question", "steer", "tool"],
  );
});

test("同步提问跟随所属轮次过程，独立于其他轮次及最终回答", () => {
  const request = { id: "request", params: { turnId: "turn-1" } };
  const groups = conversationGroups(
    [
      user,
      progress,
      answer,
      item("next-user", "userMessage", { turnId: "turn-2" }),
    ],
    [request],
  );
  assert.deepEqual(
    groups.map((group) => group.id),
    ["user", "process-turn-1", "request-request", "answer", "next-user"],
  );
});

test("重新出现的同步待答请求替换页面中的旧结束记录", () => {
  const request = { id: 37, params: { turnId: "turn-1" } };
  const groups = conversationGroups(
    [user, item("user-input-37", "userInputRequest", { request })],
    [{ ...request, id: "37" }],
  );
  assert.deepEqual(
    groups.map((group) => group.id),
    ["user", "process-turn-1", "request-37"],
  );
  assert.deepEqual(groups[1].items, []);
});

test("结束通知迟于最终回答时，提问记录仍位于最终回答上方", () => {
  const request = { id: 37, params: { turnId: "turn-1" } };
  const groups = conversationGroups([
    user,
    answer,
    item("user-input-37", "userInputRequest", { request }),
  ]);
  assert.deepEqual(
    groups.map((group) => group.id),
    ["user", "process-turn-1", "answer"],
  );
});

test("已回答的提问保持折叠，后续轮次的回答消息归入原问题", () => {
  const question = item("question", "agentMessage", {
    text: "",
    questions: [{ title: "选择部署方式" }],
  });
  const groups = conversationGroups([
    user,
    question,
    answer,
    item("response", "userMessage", {
      turnId: "turn-2",
      content: [{ type: "text", text: "选择部署方式\n回答：容器\n远程部署" }],
    }),
    { ...progress, id: "next-progress", turnId: "turn-2" },
  ]);
  assert.deepEqual(
    groups.map((group) => group.id),
    ["user", "process-turn-1", "answer", "process-turn-2"],
  );
  assert.deepEqual(groups[1].items[0].questionAnswers, ["容器\n远程部署"]);
});

test("未作答的异步提问随所属轮次完成、失败或中断收入过程", () => {
  const question = item("unanswered", "agentMessage", {
    phase: "commentary",
    text: "请补充环境信息。",
    questions: [{ title: "使用哪种环境？", options: ["本机", "远程"] }],
  });
  for (const status of ["completed", "failed", "interrupted"]) {
    const groups = conversationGroups(
      [user, progress, question],
      [],
      [{ id: "turn-1", status }],
    );
    assert.deepEqual(
      groups.map((group) => group.id),
      ["user", "process-turn-1"],
    );
    const record = groups[1].items.find((entry) => entry.id === question.id);
    assert.equal(record.questionClosed, true);
    assert.equal(record.questionAnswers, undefined);
    assert.deepEqual(record.questions, question.questions);
    assert.equal(record.text, question.text);
  }
});

test("历史最终回答关闭本轮未答问题，其他轮次的待答问题继续展开", () => {
  const question = item("old-question", "agentMessage", {
    phase: "commentary",
    text: "",
    questions: [{ title: "补充安装目录" }],
  });
  const next = { ...question, id: "new-question", turnId: "turn-2" };
  const groups = conversationGroups([user, question, answer, next]);
  assert.deepEqual(
    groups.map((group) => group.id),
    ["user", "process-turn-1", "answer", "process-turn-2", "new-question"],
  );
  assert.equal(groups[1].items[0].questionClosed, true);
  assert.equal(groups.at(-1).item, next);
});
