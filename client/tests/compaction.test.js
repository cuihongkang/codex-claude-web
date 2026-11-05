import test from "node:test";
import assert from "node:assert/strict";
import {
  mergeCompactions,
  recoverCompaction,
} from "../src/domain/compaction.js";

const entry = { id: "request", status: "reconnecting", startedAt: 100 };
const active = { status: { type: "active" } };
const compactTurn = {
  id: "compact",
  startedAt: 101,
  items: [{ type: "contextCompaction" }],
};

test("桥接结果按任务合并，已收起的提示及新任务隔离旧结果", () => {
  const finished = { ...entry, status: "completed", turnId: "compact" };
  assert.deepEqual(mergeCompactions({}, { thread: finished }), {});
  assert.deepEqual(mergeCompactions({ thread: entry }, { thread: finished }), {
    thread: finished,
  });
  const next = { id: "next", status: "starting", startedAt: 200 };
  assert.deepEqual(mergeCompactions({ thread: next }, { thread: finished }), {
    thread: next,
  });
  assert.deepEqual(mergeCompactions({}, { thread: entry }), { thread: entry });
  assert.deepEqual(
    mergeCompactions(
      { thread: { ...entry, id: "local", turnId: "compact" } },
      { thread: finished },
    ),
    { thread: finished },
  );
});

test("按整理轮次恢复完成、失败和中断，不采用旧轮次结果", () => {
  for (const status of ["completed", "failed", "interrupted"])
    assert.deepEqual(
      recoverCompaction(entry, active, [
        { ...compactTurn, id: "old", startedAt: 99, status: "completed" },
        {
          ...compactTurn,
          status,
          completedAt: 110,
          error: { message: "原因" },
        },
      ]),
      { ...entry, turnId: "compact", status, completedAt: 110, error: "原因" },
    );
});

test("真实整理仍在运行时保留占用，已知轮次可以恢复空记录", () => {
  for (const current of [entry, { ...entry, turnId: "compact" }]) {
    const recovered = recoverCompaction(current, active, [
      { ...compactTurn, status: "inProgress" },
    ]);
    assert.equal(recovered.status, "running");
    assert.equal(recovered.turnId, "compact");
  }
  assert.equal(
    recoverCompaction({ ...entry, turnId: "compact" }, active, [
      { id: "compact", status: "completed" },
    ]).status,
    "completed",
  );
});

test("普通轮次及其自动整理不会被认领为手动整理", () => {
  const ordinary = {
    ...compactTurn,
    id: "ordinary",
    status: "inProgress",
    items: [{ type: "userMessage" }, { type: "contextCompaction" }],
  };
  const recovered = recoverCompaction(entry, active, [ordinary], 120);
  assert.equal(recovered.status, "unconfirmed");
  assert.equal(recovered.turnId, undefined);
  assert.equal(recovered.completedAt, 120);
  assert.equal(
    recoverCompaction({ ...entry, turnId: ordinary.id }, active, [ordinary])
      .status,
    "unconfirmed",
  );
});

test("后端空闲时解除遗留占用，提交尚未确认时继续等待", () => {
  const idle = { status: { type: "idle" } };
  assert.equal(recoverCompaction(entry, idle, []).status, "unconfirmed");
  const starting = { ...entry, status: "starting" };
  assert.equal(recoverCompaction(starting, idle, []), starting);
});
