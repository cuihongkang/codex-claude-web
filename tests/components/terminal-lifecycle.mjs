import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";

export async function testTerminalLifecycle(app, fixture) {
  const { requests } = fixture;
  let view;
  const originalComputedStyle = globalThis.getComputedStyle;
  const originalResizeObserver = globalThis.ResizeObserver;
  let terminalTypography = { fontSize: "12px", lineHeight: "12px" };
  let resizeTerminal;
  globalThis.getComputedStyle = () => terminalTypography;
  globalThis.ResizeObserver = class {
    constructor(callback) {
      resizeTerminal = callback;
    }
    observe() {}
    disconnect() {}
  };
  app.set({ terminalOpen: true });
  await act(async () => {
    view = create(React.createElement(app.TerminalPanel), {
      createNodeMock: () => ({}),
    });
  });
  const first = localStorage.getItem("cx-terminal");
  assert(first);
  assert.deepEqual(
    requests.find((r) => r.method === "command/exec").params.sandboxPolicy,
    { type: "dangerFullAccess" },
  );
  assert.equal(testTerminals.at(-1).options.theme.background, "#ffffff");
  assert.equal(testTerminals.at(-1).options.fontSize, 12);
  assert.equal(testTerminals.at(-1).options.lineHeight, 1);
  terminalTypography = { fontSize: "18px", lineHeight: "27px" };
  await act(async () => resizeTerminal());
  assert.equal(testTerminals.at(-1).options.fontSize, 18);
  assert.equal(testTerminals.at(-1).options.lineHeight, 1.5);
  await act(async () => testTerminals.at(-1).input("\x04"));
  assert.equal(
    Buffer.from(
      requests.findLast((r) => r.method === "command/exec/write").params
        .deltaBase64,
      "base64",
    ).toString(),
    "\x04",
  );
  await act(async () =>
    fixture.socket.emit("lan/terminalExit", { processId: first, exitCode: 0 }),
  );
  assert.equal(app.get().terminalOpen, false);
  assert.equal(localStorage.getItem("cx-terminal"), null);
  await act(async () => view.unmount());
  app.set({ terminalOpen: true });
  await act(async () => {
    view = create(React.createElement(app.TerminalPanel), {
      createNodeMock: () => ({}),
    });
  });
  assert.notEqual(localStorage.getItem("cx-terminal"), first);
  await act(async () => view.unmount());
  globalThis.getComputedStyle = originalComputedStyle;
  globalThis.ResizeObserver = originalResizeObserver;
  console.log(
    "PASS 终端字号与行高同步、白底终端、Ctrl+D 传递、退出自动折叠及清理、重新打开创建新终端",
  );
}
