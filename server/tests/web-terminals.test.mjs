import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackendManager } from "../src/backends/manager.mjs";

test(
  "网页终端跨后端共用宿主 PTY、真实前台进程与独立生命周期",
  { timeout: 15000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "web-terminals-"));
    const otherDirectory = join(root, "other");
    await mkdir(otherDirectory);
    const originalShell = process.env.SHELL;
    process.env.SHELL = "/bin/sh";
    const calls = [];
    const notifications = [];
    const manager = createBackendManager({
      config: {
        configDir: root,
        codexHome: root,
        claudeHome: join(root, ".claude"),
        upstreamUrl: "ws://127.0.0.1:1",
      },
      version: {},
      send: (client, message) => client.deliver(message),
      broadcast: (message) => notifications.push(message),
      factories: {
        codex: () => ({
          ready: false,
          state: () => ({ params: {} }),
          connect() {},
          close() {},
          receive(client, message) {
            calls.push(message);
          },
        }),
      },
    });
    t.after(async () => {
      manager.close();
      if (originalShell === undefined) delete process.env.SHELL;
      else process.env.SHELL = originalShell;
      await rm(root, { recursive: true, force: true });
    });
    await manager.connect();
    let id = 0;
    const request = (method, params) =>
      new Promise((resolve, reject) =>
        manager
          .receive(
            { readyState: 1, deliver: (message) => resolve(message.result) },
            { id: ++id, method, params },
          )
          .catch(reject),
      );
    const snapshot = () => manager.state().params.terminals;
    const waitFor = async (predicate) => {
      for (let attempt = 0; attempt < 80; attempt++) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.fail("终端状态未在规定时间内更新");
    };
    for (let index = 0; index < 5; index++) {
      const result = await request("lan/terminal/create", {
        backendId: index % 2 ? "claude" : "codex",
        processId: "web-terminal-" + index,
        cwd: index < 3 ? root : otherDirectory,
        size: { cols: 90, rows: 30 },
      });
      assert.equal(result.processName, "sh");
    }
    assert.equal(calls.length, 0);
    assert.equal(snapshot()["web-terminal-0"].cwd, root);
    assert.equal(snapshot()["web-terminal-4"].cwd, otherDirectory);
    assert.equal(
      Object.values(snapshot()).filter((terminal) => terminal.running).length,
      5,
    );
    assert(
      Object.values(snapshot()).every(
        (terminal) => terminal.owner === "workspace",
      ),
    );
    const write = (processId, text) =>
      request("lan/terminal/write", {
        backendId: "claude",
        processId,
        deltaBase64: Buffer.from(text).toString("base64"),
      });
    await write("web-terminal-0", "echo RETAINED_OUTPUT\r");
    await waitFor(() =>
      snapshot()["web-terminal-0"].buffer.includes("RETAINED_OUTPUT"),
    );
    await write("web-terminal-0", "cd other\r");
    await write("web-terminal-0", "cat\r");
    await waitFor(() => snapshot()["web-terminal-0"].processName === "cat");
    assert(
      notifications.some(
        (event) =>
          event.method === "lan/terminalUpdated" &&
          event.params.processName === "cat",
      ),
    );
    await write("web-terminal-0", "\x04");
    await waitFor(() => snapshot()["web-terminal-0"].processName === "sh");
    await request("lan/terminal/resize", {
      processId: "web-terminal-0",
      size: { cols: 110, rows: 40 },
    });
    await request("lan/terminal/terminate", {
      processId: "web-terminal-1",
      backendId: "codex",
    });
    await waitFor(() => !snapshot()["web-terminal-1"].running);
    assert.equal(snapshot()["web-terminal-0"].running, true);
    assert.match(snapshot()["web-terminal-0"].buffer, /RETAINED_OUTPUT/);
    assert.equal(calls.length, 0);
    for (const [processId, terminal] of Object.entries(snapshot()))
      if (terminal.running)
        await request("lan/terminal/terminate", { processId });
    await waitFor(() =>
      Object.values(snapshot()).every((terminal) => !terminal.running),
    );
    await assert.rejects(
      request("lan/terminal/write", {
        processId: "web-terminal-0",
        deltaBase64: "YQ==",
      }),
      /终端已结束/,
    );
  },
);
