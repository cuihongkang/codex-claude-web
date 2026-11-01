import test from "node:test";
import assert from "node:assert/strict";
import {
  applyAgentEvent,
  mergeAgentHistory,
  subAgentAction,
  subAgents,
  withParentMessages,
} from "../src/sub-agents.js";

test("主代理消息定位到对应轮次和活动前，刷新去重且保留相同正文的后续发送", () => {
  const incoming = (id, turnId, beforeItemId) => ({
    id,
    turnId,
    beforeItemId,
    type: "userMessage",
    content: [{ type: "text", text: "检查接口" }],
  });
  const items = [
    { id: "first", turnId: "one", type: "reasoning" },
    { id: "answer", turnId: "one", type: "agentMessage", text: "结果" },
    { id: "second", turnId: "two", type: "reasoning" },
  ];
  const messages = [
    incoming("task", "one", "first"),
    incoming("follow", "two", "second"),
  ];
  const merged = withParentMessages(items, messages);
  assert.deepEqual(
    merged.map((m) => m.id),
    ["task", "first", "answer", "follow", "second"],
  );
  assert.deepEqual(withParentMessages(merged, messages), merged);
  assert.equal(items.length, 3);
  assert.equal(
    withParentMessages([incoming("native", "one")], [messages[0]]).length,
    1,
  );
  assert.equal(
    withParentMessages([], [incoming("a", "one"), incoming("b", "one")]).length,
    2,
  );
  assert.deepEqual(
    withParentMessages(items, [incoming("a", "one"), incoming("b", "one")]).map(
      (item) => item.id,
    ),
    ["a", "b", "first", "answer", "second"],
  );
});

test("子代理按对话 ID 合并活动，保留名称、模型与明确结束状态", () => {
  const activity = {
    type: "subAgentActivity",
    agentThreadId: "agent-a",
    agentPath: "/root/check_history",
  };
  const agents = subAgents([
    {
      ...activity,
      kind: "started",
      model: "fixture-model",
      reasoningEffort: "high",
    },
    { ...activity, kind: "completed", model: null },
    { ...activity, kind: "interacted", reasoningEffort: null },
    { type: "agentMessage", text: "完成" },
  ]);
  assert.equal(agents.length, 1);
  assert.deepEqual(agents[0], {
    id: "agent-a",
    path: "/root/check_history",
    name: "check_history",
    status: "completed",
    message: undefined,
    prompt: undefined,
    model: "fixture-model",
    reasoningEffort: "high",
  });
  assert.equal(
    subAgentAction({ ...activity, kind: "interacted" }),
    "更新子代理",
  );
});

test("协作工具合并多个接收者及状态，旧记录保持可区分的名称", () => {
  const item = {
    type: "collabAgentToolCall",
    tool: "spawnAgent",
    receiverThreadIds: ["agent-a", "agent-a"],
    prompt: "检查协议",
    agentsStates: {
      "agent-a": { status: "running", message: null },
      "agent-b": { status: "errored", message: "模拟失败" },
    },
  };
  const agents = subAgents([item]);
  assert.equal(agents.length, 2);
  assert.equal(agents[0].status, "running");
  assert.equal(agents[1].message, "模拟失败");
  assert.deepEqual(
    agents.map((agent) => agent.name),
    ["子代理 1", "子代理 2"],
  );
  assert.equal(subAgentAction(item), "创建子代理");
  assert.equal(
    subAgents([
      { type: "subAgentActivity", agentThreadId: "a", kind: "interacted" },
    ])[0].status,
    "unknown",
  );
});

test("子代理流式更新保持历史前缀，完成记录替换流式正文且按记录 ID 去重", () => {
  const original = [
    { id: "reply", type: "agentMessage", text: "历史前缀", turnId: "turn" },
  ];
  const updated = applyAgentEvent(original, "item/agentMessage/delta", {
    itemId: "reply",
    turnId: "turn",
    delta: "新增正文",
  });
  assert.equal(original[0].text, "历史前缀");
  assert.equal(updated[0].text, "历史前缀新增正文");
  const completed = applyAgentEvent(updated, "item/completed", {
    turnId: "turn",
    item: {
      id: "reply",
      type: "agentMessage",
      text: "最终正文",
      phase: "final_answer",
    },
  });
  assert.equal(completed.length, 1);
  assert.equal(completed[0].text, "最终正文");
  assert.equal(completed[0].phase, "final_answer");
});

test("分页快照与读取期间的流式更新合并，省略已包含的文字并保留命令输出", () => {
  const events = [
    {
      method: "item/agentMessage/delta",
      params: { itemId: "reply", turnId: "turn", delta: "读取期间新增" },
    },
  ];
  for (const text of ["历史前缀", "历史前缀读取期间", "历史前缀读取期间新增"])
    assert.equal(
      mergeAgentHistory(
        [{ id: "reply", type: "agentMessage", text }],
        events,
      )[0].text,
      "历史前缀读取期间新增",
    );
  const output = mergeAgentHistory(
    [
      {
        id: "command",
        type: "commandExecution",
        aggregatedOutput: "first\nsecond\n",
      },
    ],
    [
      {
        method: "item/commandExecution/outputDelta",
        params: { itemId: "command", turnId: "turn", delta: "second\nthird\n" },
      },
    ],
  );
  assert.equal(output[0].aggregatedOutput, "first\nsecond\nthird\n");
  const final = {
    id: "reply",
    type: "agentMessage",
    text: "最终正文",
    phase: "final_answer",
  };
  assert.equal(
    mergeAgentHistory(
      [{ id: "reply", text: "旧正文" }],
      [
        ...events,
        { method: "item/completed", params: { item: final, turnId: "turn" } },
      ],
    )[0].text,
    "最终正文",
  );
});
