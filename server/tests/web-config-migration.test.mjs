import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";
import { migrateWebDirectory } from "../src/web-config-migration.mjs";
import { readTls } from "../src/tls.mjs";
import { createAuthentication } from "../src/auth.mjs";

test("升级保留证书指纹和维护凭据，迁移目录及文件权限受限，既有配置优先", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "web-upgrade-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const old = {
    configDir: join(root, "codex", "codex-web"),
    codexHome: join(root, "codex"),
  };
  const original = await readTls(old);
  await createAuthentication(old);
  const token = await readFile(
    join(old.configDir, "auth", "maintenance-token"),
    "utf8",
  );
  const cookie = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(cookie).digest("hex");
  await writeFile(
    join(old.configDir, "auth", "sessions.json"),
    JSON.stringify([
      [hash, { username: userInfo().username, expiresAt: Date.now() + 60000 }],
    ]),
  );
  const config = { ...old, configDir: join(root, "web") };
  assert.deepEqual((await readTls(config)).cert, original.cert);
  const auth = await createAuthentication(config);
  assert.equal(
    auth.valid(
      auth.sessionId({
        headers: { cookie: "__Host-codex-web-session=" + cookie },
      }),
    ).username,
    userInfo().username,
  );
  assert.equal(
    await readFile(join(config.configDir, "auth", "maintenance-token"), "utf8"),
    token,
  );
  assert.equal((await stat(join(config.configDir, "tls"))).mode & 0o777, 0o700);
  assert.equal(
    (await stat(join(config.configDir, "tls", "private-key.pem"))).mode & 0o777,
    0o600,
  );
  await writeFile(
    join(config.configDir, "auth", "maintenance-token"),
    "current-token",
  );
  await createAuthentication(config);
  assert.equal(
    await readFile(join(config.configDir, "auth", "maintenance-token"), "utf8"),
    "current-token",
  );
});

test("无旧配置直接初始化，损坏的旧证书对报告实际错误", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "web-migration-incomplete-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = {
    configDir: join(root, "web"),
    codexHome: join(root, "codex"),
  };
  await migrateWebDirectory(config, "auth", ["sessions.json"]);
  await assert.rejects(stat(config.configDir), { code: "ENOENT" });
  const legacy = join(config.codexHome, "codex-web", "tls");
  await mkdir(legacy, { recursive: true });
  await writeFile(join(legacy, "certificate.pem"), "incomplete");
  await assert.rejects(readTls(config), /旧 HTTPS 证书或私钥缺失/);
});
