import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";

export async function testTerminalLifecycle(app, fixture) {
  const { requests } = fixture;
  let view;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.document = { body: { classList: { add() {}, remove() {} } } };
  const originalComputedStyle = globalThis.getComputedStyle;
  const originalResizeObserver = globalThis.ResizeObserver;
  let terminalTypography = { fontSize: "12px", lineHeight: "12px" };
  let resizeTerminal;
  const createNodeMock = (element) => ({
    parentElement: {
      clientWidth: 1024,
      querySelector: () => ({ getBoundingClientRect: () => ({ height: 600 }) }),
    },
    getBoundingClientRect: () => ({
      width:
        element.props.className === "terminal-list-width-guide" ? 110.5 : 140,
      height: 39,
    }),
  });
  globalThis.getComputedStyle = () => ({
    ...terminalTypography,
    getPropertyValue: () => "0.4",
  });
  globalThis.ResizeObserver = class {
    constructor(callback) {
      resizeTerminal = callback;
    }
    observe() {}
    disconnect() {}
  };
  app.set({ cwd: "/fixture/terminal-a", terminalOpen: true });
  await act(async () => {
    view = create(React.createElement(app.TerminalPanel), { createNodeMock });
  });
  const first = localStorage.getItem("cx-terminal");
  assert(first);
  await act(async () =>
    fixture.socket.emit("lan/terminalStarted", {
      processId: first,
      owner: "workspace",
      cwd: app.get().cwd,
      processName: "zsh",
    }),
  );
  const creation = requests.find((r) => r.method === "lan/terminal/create");
  assert(creation);
  assert.equal(creation.params.backendId, undefined);
  assert.equal(creation.params.command, undefined);
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
      requests.findLast((r) => r.method === "lan/terminal/write").params
        .deltaBase64,
      "base64",
    ).toString(),
    "\x04",
  );
  const terminalCount = testTerminals.length;
  const terminations = requests.filter(
    (r) => r.method === "lan/terminal/terminate",
  ).length;
  await act(async () =>
    view.root.findByProps({ title: "新建终端" }).props.onClick(),
  );
  const second = localStorage.getItem("cx-terminal");
  assert.notEqual(second, first);
  await act(async () =>
    fixture.socket.emit("lan/terminalStarted", {
      processId: second,
      owner: "workspace",
      cwd: app.get().cwd,
      processName: "zsh",
    }),
  );
  assert.equal(testTerminals.length, terminalCount + 1);
  assert.equal(
    requests.filter((r) => r.method === "lan/terminal/terminate").length,
    terminations,
  );
  const tabs = () =>
    view.root
      .findAllByType("button")
      .filter((node) => node.props["aria-pressed"] !== undefined);
  const extra = [];
  await act(async () =>
    fixture.socket.emit("lan/terminalUpdated", {
      processId: second,
      processName: "zsh",
    }),
  );
  assert.equal(tabs()[1].props["aria-label"], "zsh");
  await act(async () =>
    fixture.socket.emit("lan/terminalUpdated", {
      processId: second,
      processName: "python3",
    }),
  );
  assert.equal(tabs()[1].props["aria-label"], "Python");
  assert.equal(
    view.root.findAllByProps({ className: "terminal-process-icon" }).length,
    1,
  );
  await act(async () =>
    fixture.socket.emit("lan/terminalUpdated", {
      processId: second,
      processName: "zsh",
    }),
  );
  assert.equal(tabs()[1].props["aria-label"], "zsh");
  for (let index = 0; index < 3; index++) {
    await act(async () =>
      view.root.findByProps({ title: "新建终端" }).props.onClick(),
    );
    const id = localStorage.getItem("cx-terminal");
    extra.push(id);
    await act(async () =>
      fixture.socket.emit("lan/terminalStarted", {
        processId: id,
        owner: "workspace",
        cwd: app.get().cwd,
        processName: "zsh",
      }),
    );
  }
  assert.equal(new Set([first, second, ...extra]).size, 5);
  assert.equal(tabs().length, 5);
  assert.equal(testTerminals.length, terminalCount + 4);
  assert.equal(
    requests.filter((r) => r.method === "lan/terminal/terminate").length,
    terminations,
  );
  await act(async () => tabs()[0].props.onClick());
  assert.equal(localStorage.getItem("cx-terminal"), first);
  assert.equal(testTerminals.length, terminalCount + 4);
  const creationsBeforeSwitch = requests.filter(
    (r) => r.method === "lan/terminal/create",
  ).length;
  await act(async () => app.set({ cwd: "/fixture/terminal-b" }));
  assert.equal(app.get().terminalOpen, false);
  assert.equal(
    view.root.findAllByProps({ className: "terminal-panel" }).length,
    0,
  );
  assert.equal(
    requests.filter((r) => r.method === "lan/terminal/create").length,
    creationsBeforeSwitch,
  );
  await act(async () => app.set({ terminalOpen: true }));
  const other = localStorage.getItem("cx-terminal");
  assert(![first, second, ...extra].includes(other));
  await act(async () =>
    fixture.socket.emit("lan/terminalStarted", {
      processId: other,
      owner: "workspace",
      cwd: app.get().cwd,
      processName: "zsh",
    }),
  );
  assert.equal(tabs().length, 0);
  await act(async () => app.set({ cwd: "/fixture/terminal-a" }));
  assert.equal(app.get().terminalOpen, true);
  assert.equal(tabs().length, 5);
  assert.equal(localStorage.getItem("cx-terminal"), first);
  assert.equal(
    requests.filter((r) => r.method === "lan/terminal/create").length,
    creationsBeforeSwitch + 1,
  );
  await act(async () =>
    fixture.socket.emit("lan/terminalExit", { processId: other, exitCode: 0 }),
  );
  assert.equal(app.get().terminalOpen, true);
  assert.equal(localStorage.getItem("cx-terminal"), first);
  for (const id of extra) {
    await act(async () =>
      fixture.socket.emit("lan/terminalExit", { processId: id, exitCode: 0 }),
    );
  }
  await act(async () =>
    fixture.socket.emit("lan/terminalExit", { processId: first, exitCode: 0 }),
  );
  assert.equal(app.get().terminalOpen, true);
  assert.equal(localStorage.getItem("cx-terminal"), second);
  await act(async () =>
    fixture.socket.emit("lan/terminalExit", { processId: second, exitCode: 0 }),
  );
  assert.equal(app.get().terminalOpen, false);
  assert.equal(localStorage.getItem("cx-terminal"), null);
  await act(async () => view.unmount());
  app.set({ terminalOpen: true });
  await act(async () => {
    view = create(React.createElement(app.TerminalPanel), {
      createNodeMock,
    });
  });
  assert.notEqual(localStorage.getItem("cx-terminal"), first);
  const legacy = localStorage.getItem("cx-terminal");
  await act(async () =>
    fixture.socket.emit("lan/terminalStarted", {
      processId: legacy,
      owner: "workspace",
      processName: "zsh",
    }),
  );
  await act(async () =>
    fixture.socket.emit("lan/terminalExit", {
      processId: legacy,
      exitCode: 0,
    }),
  );
  assert.equal(app.get().terminalOpen, false);
  assert.equal(
    view.root.findAllByProps({ className: "terminal-panel" }).length,
    0,
  );
  await act(async () => view.unmount());
  globalThis.window = originalWindow;
  globalThis.document = originalDocument;
  globalThis.getComputedStyle = originalComputedStyle;
  globalThis.ResizeObserver = originalResizeObserver;
  console.log(
    "PASS 连续创建五个独立终端、切换复用实例、逐个退出、字号与行高、Ctrl+D、最后退出折叠及重新创建",
  );
}
