import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";

export async function testInputQueue(app, fixture) {
  const original = app.get(),
    previous = fixture.responseFor;
  const id = "backend:claude:queue-fixture";
  const backend = (ready) => [
    { id: "claude", ready, capabilities: { inputRecovery: true } },
  ];
  const entry = (text) => ({
    id: text,
    status: "uncertain",
    input: [{ type: "text", text }],
  });
  let entries = [entry("待核对输入")],
    held = false,
    view;
  const pending = [];
  fixture.responseFor = ({ method }) => {
    if (method !== "lan/inputQueue/list") return {};
    return held ? new Promise((resolve) => pending.push(resolve)) : { entries };
  };
  try {
    app.set({
      connected: true,
      current: { id },
      backendId: "claude",
      backends: backend(true),
    });
    await act(async () => {
      view = create(React.createElement(app.InputQueue));
    });
    const text = () => JSON.stringify(view.toJSON());
    assert.match(text(), /待核对输入/);
    await act(async () => app.set({ backends: backend(false) }));
    assert.match(text(), /待核对输入/);
    assert(
      view.root
        .findAllByType("button")
        .every((button) => button.props.disabled),
    );
    entries = [entry("恢复后的输入")];
    await act(async () => app.set({ backends: backend(true) }));
    assert.match(text(), /恢复后的输入/);
    assert.doesNotMatch(text(), /待核对输入/);
    held = true;
    await act(async () => {
      fixture.socket.emit("lan/inputQueue/updated", { threadId: id });
      fixture.socket.emit("lan/inputQueue/updated", { threadId: id });
    });
    assert.equal(pending.length, 2);
    await act(async () => pending[1]({ entries: [entry("最新队列")] }));
    await act(async () => pending[0]({ entries: [entry("过期队列")] }));
    assert.match(text(), /最新队列/);
    assert.doesNotMatch(text(), /过期队列/);
  } finally {
    await act(async () => view?.unmount());
    fixture.responseFor = previous;
    app.set(original);
  }
  console.log(
    "PASS 待核对输入在后端断线时保留、恢复后刷新，重复通知隔离迟到队列",
  );
}
