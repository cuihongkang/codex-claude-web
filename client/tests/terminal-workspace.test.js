import test from "node:test";
import assert from "node:assert/strict";
import {
  terminalWorkspace,
  terminalSelectionKey,
  workspaceTerminalIds,
} from "../../shared/terminal-workspace.mjs";
import { createAppState } from "../src/application/state.js";

test("终端按完整启动目录隔离，规范路径并保留中文目录", () => {
  const terminals = {
    a: { running: true, owner: "workspace", cwd: "/项目/a/目录/" },
    b: { running: true, owner: "workspace", cwd: "/其他/a/目录" },
    ended: { running: false, owner: "workspace", cwd: "/项目/a/目录" },
    native: { running: true, owner: "backend", cwd: "/项目/a/目录" },
    unknown: { running: true, owner: "workspace" },
  };
  assert.equal(terminalWorkspace("/项目/a//b/../目录/."), "/项目/a/目录");
  assert.deepEqual(workspaceTerminalIds(terminals, "/项目/a/目录"), ["a"]);
  assert.notEqual(
    terminalSelectionKey("/项目/a/目录"),
    terminalSelectionKey("/其他/a/目录"),
  );
  assert.deepEqual(workspaceTerminalIds(terminals, "/empty"), []);
});

test("面板按文件夹恢复开关，同目录对话及后端切换保留，其他目录退出不影响当前目录", (t) => {
  const storage = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  t.after(() => (globalThis.localStorage = storage));
  const state = createAppState();
  const terminals = {
    a: { owner: "workspace", running: true, cwd: "/project-a" },
    b: { owner: "workspace", running: true, cwd: "/project-b" },
  };
  state.set({
    cwd: "/project-a",
    current: { id: "a1" },
    terminalOpen: true,
    terminals,
  });
  state.set({ cwd: "/project-a/", current: { id: "a2" }, backendId: "claude" });
  assert.equal(state.get().terminalOpen, true);
  state.set({ cwd: "/project-b", current: { id: "b" } });
  assert.equal(state.get().terminalOpen, false);
  state.set({ terminalOpen: true });
  state.set({ cwd: "/project-a" });
  assert.equal(state.get().terminalOpen, true);
  state.set({
    terminals: { ...terminals, b: { ...terminals.b, running: false } },
  });
  assert.equal(state.get().terminalOpen, true);
  state.set({ cwd: "/project-b" });
  assert.equal(state.get().terminalOpen, false);
  state.set({ cwd: "/project-a" });
  assert.equal(state.get().terminalOpen, true);
  state.set({ terminalOpen: false });
  state.set({ cwd: "/project-b" });
  state.set({ cwd: "/project-a" });
  assert.equal(state.get().terminalOpen, false);
});
