import test from "node:test";
import assert from "node:assert/strict";
import { actionableMessages } from "../src/domain/message-actions.js";
const progress = {
  id: "progress",
  turnId: "turn-1",
  type: "agentMessage",
  phase: "commentary",
  text: "正在检查项目。",
};
const answer = {
  id: "answer",
  turnId: "turn-1",
  type: "agentMessage",
  phase: "final_answer",
  text: "检查结果。",
};
test("首次调用中的进度消息始终不显示回复操作栏", () => {
  assert.deepEqual([...actionableMessages([progress], [], "turn-1")], []);
  assert.deepEqual(
    [
      ...actionableMessages(
        [progress],
        [{ id: "turn-1", status: "completed" }],
      ),
    ],
    [],
  );
});
test("最终文本尚在生成时不显示分支操作", () => {
  assert.deepEqual(
    [
      ...actionableMessages(
        [progress, answer],
        [{ id: "turn-1", status: "inProgress" }],
        "turn-1",
      ),
    ],
    [],
  );
});
test("整轮完成后只在最终回答显示一组操作", () => {
  assert.deepEqual(
    [
      ...actionableMessages(
        [progress, answer],
        [{ id: "turn-1", status: "completed" }],
      ),
    ],
    ["answer"],
  );
});
test("旧会话没有消息阶段时使用整轮状态和最后一条回复", () => {
  assert.deepEqual(
    [
      ...actionableMessages(
        [
          { ...progress, phase: null },
          { ...answer, phase: null },
        ],
        [{ id: "turn-1", status: "completed" }],
      ),
    ],
    ["answer"],
  );
});
test("中断和失败的轮次不提供最终回复分支操作", () => {
  for (const status of ["interrupted", "failed"])
    assert.deepEqual(
      [...actionableMessages([answer], [{ id: "turn-1", status }])],
      [],
    );
});
