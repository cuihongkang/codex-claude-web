import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";

export async function testComposerPerformance(app) {
  const original = app.get();
  let sharedRenders = 0;
  let draftRenders = 0;
  let sharedSnapshot;
  let draftSnapshot;
  let view;
  function SharedView() {
    sharedSnapshot = app.useStore();
    sharedRenders++;
    return null;
  }
  function DraftView() {
    draftSnapshot = app.useDraft();
    draftRenders++;
    return null;
  }
  try {
    app.set({ current: { id: "input-performance" }, draft: "" });
    await act(async () => {
      view = create(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(SharedView),
          React.createElement(DraftView),
        ),
      );
    });
    const stableSnapshot = sharedSnapshot;
    const initialSharedRenders = sharedRenders;
    const initialDraftRenders = draftRenders;
    const text = "语音输入一次写入长段文字。".repeat(500);
    for (let i = 0; i < 5; i++) {
      await act(async () => app.setDraft(text + i));
      assert.equal(app.get().draft, text + i, "发送接口立即取得最新草稿");
      assert.equal(draftSnapshot, text + i, "输入框立即收到最新草稿");
      assert.equal(
        localStorage.getItem("cx-draft-input-performance"),
        text + i,
        "每次输入保持草稿持久化",
      );
      assert.equal(sharedSnapshot, stableSnapshot, "草稿变化保留共享快照引用");
    }
    assert.equal(
      sharedRenders,
      initialSharedRenders,
      "草稿变化不重绘页面其他订阅者",
    );
    assert.equal(draftRenders, initialDraftRenders + 5);
    await act(async () => app.set({ draft: "", busy: true }));
    assert.equal(draftSnapshot, "", "发送清理同步通知草稿订阅者");
    assert.equal(sharedSnapshot.busy, true, "共享状态仍同步通知页面订阅者");
    assert.equal(sharedRenders, initialSharedRenders + 1);
    await act(async () =>
      app.set({ current: { id: "another-input" }, draft: "另一对话草稿" }),
    );
    assert.equal(draftSnapshot, "另一对话草稿", "切换对话同时更新草稿");
    assert.equal(sharedSnapshot.current.id, "another-input");
    const renders = draftRenders;
    await act(async () => app.set({ notice: "共享状态更新" }));
    assert.equal(draftRenders, renders, "共享状态变化保持草稿订阅稳定");
    console.log(
      "PASS 长段草稿独立订阅、共享快照稳定、即时发送和持久化、发送清理及切换同步",
    );
  } finally {
    if (view) await act(async () => view.unmount());
    app.set(original);
    localStorage.removeItem("cx-draft-input-performance");
  }
}
