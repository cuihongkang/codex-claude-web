import test from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readConfig } from "../src/config.mjs";

test("默认目录跟随当前用户，静态目录定位到项目构建目录", () => {
  const config = readConfig({});
  assert.equal(config.defaultCwd, homedir());
  assert.equal(config.codexHome, join(homedir(), ".codex"));
  assert.equal(
    config.projectlessRoot,
    join(homedir(), ".config", "claudex-web", "workspaces"),
  );
  assert.equal(
    config.staticDir,
    fileURLToPath(new URL("../../client/dist/", import.meta.url)),
  );
  assert.equal(config.port, 8766);
});
test("环境变量覆盖绑定地址、端口和后端地址", () => {
  const config = readConfig({
    HOST: "127.0.0.1",
    PORT: "9876",
    CODEX_APP_SERVER_URL: "ws://127.0.0.1:9875",
    DEFAULT_CWD: "/tmp",
    CODEX_HOME: "/tmp/custom-codex",
    CLAUDEX_WEB_CONFIG_DIR: "/tmp/custom-web",
    CLAUDE_CONFIG_DIR: "/tmp/custom-claude",
    STATIC_DIR: "/tmp/public",
  });
  assert.equal(config.port, 9876);
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.upstreamUrl, "ws://127.0.0.1:9875");
  assert.equal(config.defaultCwd, "/tmp");
  assert.equal(config.codexHome, "/tmp/custom-codex");
  assert.equal(config.projectlessRoot, "/tmp/custom-web/workspaces");
  assert.equal(config.staticDir, "/tmp/public");
});
test("错误端口和协议在启动时报告", () => {
  assert.throws(() => readConfig({ PORT: "abc" }), /PORT/);
  assert.throws(
    () => readConfig({ CODEX_APP_SERVER_URL: "http://localhost" }),
    /WebSocket/,
  );
});
