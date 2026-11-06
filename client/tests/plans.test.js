import test from "node:test";
import assert from "node:assert/strict";
import {
  pendingPlan,
  planApprovalLabel,
  planImplementationText,
} from "../src/domain/plans.js";
import { conversationGroups } from "../src/domain/conversation-groups.js";

const user = { id: "user", type: "userMessage", turnId: "t" };
const plan = { id: "plan", type: "plan", turnId: "t", text: "# 实现方案" };
const turns = [{ id: "t", status: "completed" }];

test("方案始终独立于工作过程，多个方案按消息顺序展示", () => {
  const activity = { id: "tool", type: "commandExecution", turnId: "t" };
  const next = { ...plan, id: "revised", text: "修订后的方案" };
  const groups = conversationGroups([user, activity, plan, next]);
  assert.deepEqual(
    groups.map((group) => group.id),
    ["user", "process-t", "plan", "revised"],
  );
  assert.equal(pendingPlan([user, plan, next], turns), next);
});

test("批准只针对最新已成功完成的方案，排除运行、失败、后续消息与空内容", () => {
  assert.equal(pendingPlan([user, plan], turns), plan);
  for (const status of ["inProgress", "failed", "interrupted"])
    assert.equal(pendingPlan([user, plan], [{ id: "t", status }]), null);
  assert.equal(pendingPlan([user, plan], []), null);
  assert.equal(pendingPlan([user, plan], turns, "t"), null);
  assert.equal(
    pendingPlan([user, plan, { ...user, id: "next", turnId: "new" }], turns),
    null,
  );
  assert.equal(pendingPlan([user, { ...plan, text: " " }], turns), null);
});

test("批准消息传输完整方案，展示操作摘要，其他正文保留原文", () => {
  const prompt = planImplementationText(plan);
  assert(prompt.includes(plan.text));
  assert.equal(planApprovalLabel(prompt), "批准并执行计划");
  assert.equal(
    planApprovalLabel("请解释 Implement the following plan: 的含义"),
    "请解释 Implement the following plan: 的含义",
  );
});
