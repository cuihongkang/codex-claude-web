import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";

export async function testConversationScroll(app) {
  const original = app.get();
  const originalObserver = globalThis.ResizeObserver;
  const observers = new Set();
  const column = {};
  let position = 0;
  let view;
  const scroller = {
    scrollHeight: 2400,
    clientHeight: 600,
    get scrollTop() {
      return position;
    },
    set scrollTop(top) {
      position = Math.max(
        0,
        Math.min(top, this.scrollHeight - this.clientHeight),
      );
    },
    scrollTo({ top }) {
      this.scrollTop = top;
    },
  };
  globalThis.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
      this.targets = new Set();
      observers.add(this);
    }
    observe(target) {
      this.targets.add(target);
    }
    disconnect() {
      observers.delete(this);
    }
  };
  const gap = () =>
    scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
  const onScroll = () =>
    view.root.findByProps({ className: "conversation" }).props.onScroll();
  const resize = async () => {
    await act(async () => {
      for (const observer of observers) observer.callback();
      onScroll();
    });
  };
  const item = {
    id: "scroll-answer",
    type: "agentMessage",
    phase: "final_answer",
    turnId: "scroll-turn",
    text: "滚动位置回归测试",
  };
  try {
    app.set({
      current: { id: "scroll-fixture" },
      items: [item],
      loading: false,
      active: {},
      questions: [],
      plans: {},
    });
    await act(async () => {
      view = create(React.createElement(app.Conversation), {
        createNodeMock: ({ props }) => {
          if (props.className === "conversation") return scroller;
          if (props.className === "message-column") return column;
          return {
            scrollIntoView() {
              scroller.scrollTop =
                scroller.scrollHeight - scroller.clientHeight - 6;
            },
          };
        },
      });
    });
    assert.equal(gap(), 0, "打开对话定位到含底部内边距的真实底部");
    assert.equal(observers.size, 1);
    assert.deepEqual([...observers][0].targets, new Set([scroller, column]));
    await act(async () => {
      scroller.scrollTop = scroller.scrollHeight;
      onScroll();
      app.set({ items: [{ ...item }] });
    });
    assert.equal(gap(), 0, "手动到底后延迟状态更新保持原位");

    scroller.clientHeight -= 12;
    await resize();
    assert.equal(gap(), 0, "输入框恢复造成容器变矮时继续保持底部");
    scroller.scrollHeight += 300;
    await resize();
    assert.equal(gap(), 0, "图片或图表延迟增高超过跟随阈值时仍保持底部");
    scroller.clientHeight -= 150;
    await act(async () => onScroll());
    assert.equal(gap(), 0, "布局变化先触发滚动事件时继续自动跟随");

    await act(async () => {
      scroller.scrollTop -= 400;
      onScroll();
    });
    const reading = position;
    scroller.scrollHeight += 200;
    await resize();
    await act(async () => app.set({ items: [{ ...item, text: "后续更新" }] }));
    assert.equal(position, reading, "向上阅读时尺寸变化和消息更新保留位置");
    await act(async () =>
      view.root.findByProps({ title: "回到最新消息" }).props.onClick(),
    );
    assert.equal(gap(), 0, "回到最新消息按钮使用真实底部");
    await act(async () => onScroll());
    scroller.scrollHeight += 150;
    await resize();
    assert.equal(gap(), 0, "回到底部后恢复尺寸变化时的自动跟随");

    await act(async () => {
      scroller.scrollTop -= 400;
      onScroll();
      app.set({ current: { id: "scroll-other-fixture" } });
    });
    assert.equal(gap(), 0, "切换对话重新定位，即使消息数组引用相同");
    assert.equal(observers.size, 1, "切换对话清理旧尺寸监听");
    await act(async () => app.set({ current: null, items: [] }));
    assert.equal(observers.size, 0, "新建空对话清理尺寸监听");
    await act(async () =>
      app.set({ current: { id: "scroll-fixture" }, items: [item] }),
    );
    assert.equal(observers.size, 1);
    await act(async () => view.unmount());
    view = null;
    assert.equal(observers.size, 0, "卸载对话清理尺寸监听");
  } finally {
    if (view) await act(async () => view.unmount());
    app.set(original);
    globalThis.ResizeObserver = originalObserver;
  }
  console.log(
    "PASS 对话真实底部定位、延迟更新与尺寸变化跟随、历史阅读位置、返回底部和监听清理",
  );
}
