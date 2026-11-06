import { readTls } from "../src/tls.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  productDirectories,
  migrateProductConfig,
} from "../src/product-config.mjs";

test("品牌目录遵循 XDG 与显式配置，旧变量仅指定迁移来源", () => {
  assert.deepEqual(productDirectories({ XDG_CONFIG_HOME: "/tmp/config" }), {
    configDir: "/tmp/config/claudex-web",
    legacyConfigDir: "/tmp/config/codex-web",
  });
  assert.deepEqual(
    productDirectories({
      CLAUDEX_WEB_CONFIG_DIR: "/tmp/new",
      CODEX_WEB_CONFIG_DIR: "/tmp/old",
    }),
    { configDir: "/tmp/new", legacyConfigDir: "/tmp/old" },
  );
});

test("首次更名复制完整配置并迁移 Claude 索引，原目录和新配置优先", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "claudex-migration-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directories = productDirectories({ XDG_CONFIG_HOME: root });
  const oldIndex = join(directories.legacyConfigDir, "backends", "claude");
  await mkdir(oldIndex, { recursive: true });
  await writeFile(
    join(oldIndex, "codex-web-index.json"),
    '{"sessions":{"old":{}}}',
  );
  await writeFile(join(directories.legacyConfigDir, ".env"), "PORT=9876\n");
  await migrateProductConfig(directories);
  assert.equal(
    await readFile(join(directories.configDir, ".env"), "utf8"),
    "PORT=9876\n",
  );
  assert.equal(
    await readFile(
      join(directories.configDir, "backends/claude/claudex-web-index.json"),
      "utf8",
    ),
    '{"sessions":{"old":{}}}',
  );
  assert.equal((await stat(directories.configDir)).mode & 0o777, 0o700);
  assert.equal(
    await readFile(join(oldIndex, "codex-web-index.json"), "utf8"),
    '{"sessions":{"old":{}}}',
  );
  await writeFile(join(directories.configDir, ".env"), "PORT=8766\n");
  await migrateProductConfig(directories);
  assert.equal(
    await readFile(join(directories.configDir, ".env"), "utf8"),
    "PORT=8766\n",
  );
});

test("命令入口在配置初始化前继承旧环境，重复初始化保留配置", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "claudex-cli-migration-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { ...process.env, XDG_CONFIG_HOME: root };
  delete env.CLAUDEX_WEB_CONFIG_DIR;
  delete env.CODEX_WEB_CONFIG_DIR;
  const directories = productDirectories(env);
  await mkdir(directories.legacyConfigDir);
  await writeFile(join(directories.legacyConfigDir, ".env"), "PORT=9876\n");
  const run = () =>
    execFileSync(process.execPath, ["bin/claudex-web.mjs", "config", "init"], {
      env,
      encoding: "utf8",
    });
  assert.match(run(), /claudex-web\/\.env/);
  run();
  assert.equal(
    await readFile(join(directories.configDir, ".env"), "utf8"),
    "PORT=9876\n",
  );
});

test("开发服务首次读取证书时先迁移配置，保留原有证书", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "claudex-tls-upgrade-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directories = productDirectories({ XDG_CONFIG_HOME: root });
  const original = await readTls({
    configDir: directories.legacyConfigDir,
    codexHome: root,
  });
  await writeFile(join(directories.legacyConfigDir, ".env"), "PORT=9876\n");
  const current = await readTls({ ...directories, codexHome: root });
  assert.deepEqual(current.cert, original.cert);
  assert.equal(
    await readFile(join(directories.configDir, ".env"), "utf8"),
    "PORT=9876\n",
  );
});
