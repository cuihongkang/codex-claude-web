import test from "node:test";
import assert from "node:assert/strict";
import { createCliInstallation } from "../src/backends/cli-installation.mjs";

test("未安装时仍取得最新版本，安装使用固定 npm 包并重新检测", async () => {
  let installed = false;
  const calls = [];
  const cli = createCliInstallation({
    locate: async () => {
      if (!installed) throw new Error("未找到 claude");
      return "/npm/bin/claude";
    },
    fetchVersion: async () => "2.1.318",
    run: async (command, args) => {
      calls.push([command, args]);
      if (args[0] === "install") installed = true;
      return { stdout: "2.1.318 (Claude Code)" };
    },
  });
  await cli.refresh("claude");
  assert.equal(cli.state("claude").installed, false);
  assert.equal(cli.state("claude").latestVersion, "2.1.318");
  await cli.install("claude");
  assert.equal(cli.state("claude").currentVersion, "2.1.318");
  assert.equal(cli.state("claude").installed, true);
  assert.equal(cli.state("claude").installing, false);
  assert.deepEqual(calls[0][1], [
    "install",
    "--global",
    "@anthropic-ai/claude-code@latest",
  ]);
  await assert.rejects(cli.install("arbitrary"), /未知后端/);
});

test("版本查询合并并发，离线保留当前与上次最新版本，安装失败可重试", async () => {
  let offline = false,
    failInstall = true,
    queries = 0;
  const cli = createCliInstallation({
    locate: async () => "/npm/bin/codex",
    fetchVersion: async () => {
      queries++;
      if (offline) throw new Error("网络不可用");
      return "1.2.3";
    },
    run: async (command, args) => {
      if (args[0] === "install" && failInstall) throw new Error("npm 权限不足");
      return { stdout: "codex-cli 1.2.2" };
    },
  });
  await Promise.all([cli.refresh("codex"), cli.refresh("codex")]);
  assert.equal(queries, 1);
  offline = true;
  await cli.refresh("codex");
  assert.equal(cli.state("codex").currentVersion, "1.2.2");
  assert.equal(cli.state("codex").latestVersion, "1.2.3");
  assert.match(cli.state("codex").latestError, /网络不可用/);
  await assert.rejects(cli.install("codex"), /权限不足/);
  assert.equal(cli.state("codex").installing, false);
  assert.match(cli.state("codex").installError, /权限不足/);
  failInstall = false;
  await cli.install("codex");
  assert.equal(cli.state("codex").installError, "");
});

test("桥接生命周期自动检测两个 CLI，每小时执行且关闭后停止", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const queries = [];
  const cli = createCliInstallation({
    locate: async (id) => `/npm/bin/${id}`,
    fetchVersion: async (name) => {
      queries.push(name);
      return "1.2.3";
    },
    run: async () => ({ stdout: "1.2.3" }),
  });
  t.after(() => cli.close());
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  cli.start();
  cli.start();
  await settle();
  assert.deepEqual(queries, ["@openai/codex", "@anthropic-ai/claude-code"]);
  t.mock.timers.tick(60 * 60 * 1000 - 1);
  await settle();
  assert.equal(queries.length, 2);
  t.mock.timers.tick(1);
  await settle();
  assert.equal(queries.length, 4);
  assert.equal(cli.state("codex").currentVersion, "1.2.3");
  cli.close();
  t.mock.timers.tick(2 * 60 * 60 * 1000);
  await settle();
  assert.equal(queries.length, 4);
});
