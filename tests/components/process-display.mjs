import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";

export async function testProcessDisplay(app, fixture) {
  const { requests } = fixture;
  app.set({
    connected: true,
    current: { id: "fixture" },
    active: {},
    items: [
      { id: "empty", type: "reasoning", summary: [] },
      {
        id: "title",
        type: "reasoning",
        summary: ["**识别 Git 分支**"],
      },
      {
        id: "body",
        type: "reasoning",
        summary: ["**验证修改结果**\n\n这里是摘要正文。"],
      },
      {
        id: "progress",
        type: "agentMessage",
        phase: "commentary",
        text: "这是进度内容，默认折叠。",
      },
      {
        id: "answer",
        type: "agentMessage",
        phase: "final_answer",
        text: "最终回答保持展开。",
      },
    ],
  });
  let view;
  await act(async () => {
    view = create(React.createElement(app.Conversation));
  });
  const tree = view.root;
  const group = tree.findByProps({ className: "process-history" });
  assert.equal(group.props.open, undefined);
  assert.equal(
    tree.findAll((n) => n.props.className === "activity reasoning-summary")
      .length,
    0,
  );
  assert(!JSON.stringify(view.toJSON()).includes("这是进度内容"));
  assert(!JSON.stringify(view.toJSON()).includes("识别 Git 分支"));
  assert(!JSON.stringify(view.toJSON()).includes("验证修改结果"));
  assert(JSON.stringify(view.toJSON()).includes("最终回答保持展开"));
  await act(async () =>
    group.props.onToggle({ currentTarget: { open: true } }),
  );
  assert.equal(
    tree.findAllByProps({ className: "process-content process-preview" })
      .length,
    0,
  );
  assert.equal(
    tree.findAll((n) => n.props.className === "activity reasoning-summary")
      .length,
    2,
  );
  assert.equal(
    tree
      .findByProps({ className: "activity-summary reasoning-title" })
      .findAllByType("button").length,
    0,
  );
  assert(JSON.stringify(view.toJSON()).includes("识别 Git 分支"));
  const detail = tree
    .findAllByType("details")
    .find((n) => n.props.className === "activity reasoning-summary");
  assert.equal(detail.props.open, undefined);
  assert.equal(detail.findByType("summary").props.title, "验证修改结果");
  assert(JSON.stringify(view.toJSON()).includes("这是进度内容"));
  await act(async () =>
    group.props.onToggle({ currentTarget: { open: false } }),
  );
  assert(!JSON.stringify(view.toJSON()).includes("这是进度内容"));
  assert(JSON.stringify(view.toJSON()).includes("最终回答保持展开"));
  await act(async () => view.unmount());
  console.log(
    "PASS 已完成的工作过程完整折叠、展开完整过程、最终回答独立、中文摘要标题",
  );
  {
    app.set({
      active: { fixture: "live-turn" },
      items: [
        {
          id: "live-progress",
          turnId: "live-turn",
          type: "agentMessage",
          phase: "commentary",
          text: "正在检查项目。",
        },
      ],
    });
    await act(async () => {
      view = create(React.createElement(app.Conversation));
    });
    const emit = async (method, params) =>
      act(async () =>
        fixture.socket.emit(method, {
          threadId: "fixture",
          turnId: "live-turn",
          ...params,
        }),
      );
    const visible = () => JSON.stringify(view.toJSON());
    assert(visible().includes("正在处理"));
    assert(visible().includes("正在检查项目"));
    await emit("item/started", {
      item: { id: "live-thought", type: "reasoning", summary: [] },
    });
    assert(visible().includes("正在检查项目"));
    await emit("item/reasoning/summaryTextDelta", {
      itemId: "live-thought",
      summaryIndex: 0,
      delta: "**定位组件**",
    });
    assert(visible().includes("定位组件"));
    assert(!visible().includes("正在检查项目"));
    await emit("item/reasoning/summaryTextDelta", {
      itemId: "live-thought",
      summaryIndex: 1,
      delta: "**验证界面**\n\n检查折叠后的内容。",
    });
    assert(visible().includes("验证界面"));
    assert(!visible().includes("定位组件"));
    await emit("item/reasoning/summaryTextDelta", {
      itemId: "live-thought",
      summaryIndex: 2,
      delta: " ",
    });
    assert(visible().includes("验证界面"));
    await emit("item/started", {
      item: {
        id: "live-tool",
        type: "commandExecution",
        command: "npm run check",
        status: "inProgress",
      },
    });
    assert(visible().includes("运行项目检查"));
    assert(!visible().includes("验证界面"));
    await emit("item/started", {
      item: {
        id: "live-update",
        type: "agentMessage",
        phase: "commentary",
        text: "",
      },
    });
    assert(visible().includes("运行项目检查"));
    await emit("item/agentMessage/delta", {
      itemId: "live-update",
      delta: "验证已完成",
    });
    await emit("item/agentMessage/delta", {
      itemId: "live-update",
      delta: "，准备交付。",
    });
    assert(visible().includes("验证已完成，准备交付。"));
    assert(!visible().includes("运行项目检查"));
    await emit("item/completed", {
      item: {
        id: "live-answer",
        type: "agentMessage",
        phase: "final_answer",
        text: "修改完成。",
      },
    });
    await act(async () => app.set({ active: {} }));
    assert(visible().includes("工作过程"));
    assert(!visible().includes("验证已完成，准备交付。"));
    assert(visible().includes("修改完成。"));
    assert.equal(
      view.root.findAllByProps({ className: "process-content process-preview" })
        .length,
      0,
    );
    await act(async () => app.set({ active: { fixture: "next-turn" } }));
    assert(!visible().includes("验证已完成，准备交付。"));
    await act(async () => app.set({ active: {} }));
    await act(async () => view.unmount());
    console.log(
      "PASS 生成时更新最新有效提示、任务完成后收起、后续任务保持历史过程折叠",
    );
  }
}
