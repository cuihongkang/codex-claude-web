import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";

export async function testCompactionDisplay(app) {
  const original = app.get();
  const thread = { id: "compaction-display" };
  const entry = { id: "manual", turnId: "manual-turn", status: "running" };
  const items = [
    {
      id: "old",
      turnId: "old-turn",
      type: "contextCompaction",
      status: "completed",
    },
    {
      id: "manual-item",
      turnId: entry.turnId,
      type: "contextCompaction",
      status: "inProgress",
    },
  ];
  let view;
  const count = (className) => view.root.findAllByProps({ className }).length;
  try {
    await act(async () => {
      app.set({
        current: thread,
        items,
        loading: false,
        questions: [],
        active: { [thread.id]: entry.turnId },
        compactions: { [thread.id]: entry },
      });
      view = create(React.createElement(app.Conversation));
    });
    for (const status of ["starting", "running", "reconnecting"]) {
      await act(async () =>
        app.set({ compactions: { [thread.id]: { ...entry, status } } }),
      );
      assert.equal(count("working-status"), 0, status);
      assert.equal(count("process-history"), 1, "保留其他轮次的历史整理记录");
      assert.equal(count("process-content process-preview"), 0);
    }
    await act(async () =>
      app.set({
        items: [
          ...items,
          {
            id: "other-activity",
            turnId: entry.turnId,
            type: "agentMessage",
            phase: "commentary",
            text: "同轮其他活动",
          },
        ],
      }),
    );
    assert.equal(count("process-history"), 2, "保留同轮其他活动");
    assert(JSON.stringify(view.toJSON()).includes("同轮其他活动"));
    await act(async () =>
      app.set({
        items,
        active: {},
        compactions: { [thread.id]: { ...entry, status: "completed" } },
      }),
    );
    assert.equal(count("process-history"), 2, "结束后恢复整理历史入口");
    await act(async () =>
      app.set({
        active: { [thread.id]: entry.turnId },
        compactions: {},
      }),
    );
    assert.equal(count("working-status"), 1, "普通任务保留工作提示");
    assert.equal(count("process-history"), 2, "自动整理保留原有过程展示");
    assert.equal(count("process-content process-preview"), 1);
  } finally {
    await act(async () => {
      view?.unmount();
      app.set(original);
    });
  }
}
