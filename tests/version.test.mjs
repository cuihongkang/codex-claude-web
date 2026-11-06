import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readVersion } from "../server/src/version.mjs";
import {
  checkVersions,
  prepareVersion,
  checkRelease,
} from "../scripts/version.mjs";

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "claudex-web-version-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const path of ["client", "server", "docs/releases"])
    await mkdir(join(dir, path), { recursive: true });
  for (const path of ["", "client", "server"])
    await writeFile(
      join(dir, path, "package.json"),
      JSON.stringify({
        name: path ? `@claudex-web/${path}` : "claudex-web",
        version: "1.2.3",
        ...(path ? {} : { workspaces: ["client", "server"] }),
      }),
    );
  await writeFile(
    join(dir, "package-lock.json"),
    JSON.stringify({
      version: "1.2.3",
      lockfileVersion: 3,
      packages: Object.fromEntries(
        ["", "client", "server"].map((key) => [key, { version: "1.2.3" }]),
      ),
    }),
  );
  await writeFile(join(dir, ".gitignore"), "build-info.json\n");
  await writeFile(
    join(dir, "CHANGELOG.md"),
    "# 变更日志\n\n## 未发布\n\n### 新增\n\n- 展示构建来源。\n\n## [1.2.3] - 2026-10-01\n\n- 初始版本。\n",
  );
  await writeFile(
    join(dir, "docs/releases/v1.2.3.md"),
    "# Claudex Web v1.2.3\n\n- 初始版本。\n",
  );
  for (const path of ["README.md", "docs/deployment.md"])
    await writeFile(
      join(dir, path),
      "https://example.test/releases/download/v1.2.3/claudex-web-1.2.3.tgz\n",
    );
  return dir;
}

function git(dir, ...args) {
  return execFileSync("git", args, {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
function commit(dir) {
  git(dir, "add", ".");
  git(
    dir,
    "-c",
    "user.name=Version Test",
    "-c",
    "user.email=version@example.test",
    "commit",
    "-qm",
    "fixture",
  );
}
function initialize(dir) {
  git(dir, "init", "-q");
  commit(dir);
  git(dir, "tag", "v1.2.3");
}

test("正式标签、日常提交及已暂存和未跟踪修改分别标识来源", async (t) => {
  const dir = await fixture(t);
  initialize(dir);
  assert.equal(readVersion(dir).displayVersion, "1.2.3");
  assert.equal(readVersion(dir).channel, "release");
  assert.equal(checkRelease(dir, "v1.2.3"), "1.2.3");
  await writeFile(join(dir, "README.md"), "changed\n");
  git(dir, "add", "README.md");
  assert.equal(readVersion(dir).dirty, true);
  commit(dir);
  const info = readVersion(dir);
  assert.equal(info.version, "1.2.3");
  assert.equal(
    info.displayVersion,
    `1.2.3+dev.g${git(dir, "rev-parse", "HEAD").slice(0, 7)}`,
  );
  assert.equal(info.channel, "development");
  assert.throws(() => checkRelease(dir, "v1.2.3"), /干净的 Git/);
  await writeFile(join(dir, "untracked.txt"), "local change\n");
  assert.match(readVersion(dir).displayVersion, /\.dirty$/);
});

test("npm 安装从构建清单恢复身份，忽略父目录 Git 仓库", async (t) => {
  const dir = await fixture(t);
  initialize(dir);
  const info = { ...readVersion(dir), builtAt: "2026-10-26T00:00:00.000Z" };
  const installed = join(dir, "installed");
  await mkdir(installed);
  await writeFile(
    join(installed, "package.json"),
    JSON.stringify({ version: "1.2.3" }),
  );
  assert.equal(readVersion(installed).channel, "unknown");
  await writeFile(join(installed, "build-info.json"), JSON.stringify(info));
  assert.deepEqual(readVersion(installed), info);
  // 源码优先读取实时 Git 状态，避免旧清单掩盖开发修改。
  await writeFile(join(dir, "build-info.json"), JSON.stringify(info));
  assert.equal(readVersion(dir).channel, "development");
  await writeFile(
    join(installed, "package.json"),
    JSON.stringify({ version: "1.2.4" }),
  );
  assert.throws(() => readVersion(installed), /构建信息与包版本不一致/);
});

test("版本准备同步包与锁文件、汇总未发布内容并更新安装地址", async (t) => {
  const dir = await fixture(t);
  for (const path of ["README.md", "docs/deployment.md"])
    await writeFile(
      join(dir, path),
      "npm install -g ./claudex-web-1.2.3.tgz\n",
    );
  initialize(dir);
  assert.equal(prepareVersion(dir, "minor", "2026-10-26"), "1.3.0");
  assert.equal(checkVersions(dir), "1.3.0");
  const changelog = await readFile(join(dir, "CHANGELOG.md"), "utf8");
  assert.match(changelog, /## 未发布[\s\S]*## \[1\.3\.0\] - 2026-10-26/);
  assert.equal(changelog.split("展示构建来源。").length, 2);
  assert.match(changelog, /## \[1\.2\.3\] - 2026-10-01/);
  const notes = await readFile(join(dir, "docs/releases/v1.3.0.md"), "utf8");
  assert.match(notes, /^# Claudex Web v1\.3\.0\n/);
  assert.match(notes, /- 展示构建来源。/);
  assert.match(
    await readFile(join(dir, "README.md"), "utf8"),
    /v1\.3\.0\/claudex-web-1\.3\.0\.tgz/,
  );
  assert.throws(() => prepareVersion(dir, "patch"), /已准备且尚未创建标签/);
  assert.throws(() => prepareVersion(dir, "1.2.4"), /大于当前版本/);
  assert.throws(() => prepareVersion(dir, "01.3.1"), /用法/);
  assert.throws(() => checkRelease(dir, "v1.2.3"), /发布标签必须匹配/);
  assert.throws(() => checkRelease(dir, "v1.3.0"), /干净的 Git/);
  commit(dir);
  git(dir, "tag", "v1.3.0");
  assert.equal(checkRelease(dir, "v1.3.0"), "1.3.0");
  await writeFile(join(dir, "docs/releases/v1.3.0.md"), "# wrong\n");
  commit(dir);
  git(dir, "tag", "-f", "v1.3.0");
  assert.throws(() => checkRelease(dir, "v1.3.0"), /标题需要匹配/);
});

test("版本检查拒绝 workspace 和锁文件漂移", async (t) => {
  const dir = await fixture(t);
  await writeFile(
    join(dir, "client/package.json"),
    JSON.stringify({ version: "1.2.4" }),
  );
  assert.throws(() => checkVersions(dir), /client.*版本与根包不一致/);
  await writeFile(
    join(dir, "client/package.json"),
    JSON.stringify({ version: "1.2.3" }),
  );
  const lock = JSON.parse(await readFile(join(dir, "package-lock.json")));
  lock.packages.server.version = "1.2.4";
  await writeFile(join(dir, "package-lock.json"), JSON.stringify(lock));
  assert.throws(() => checkVersions(dir), /server 版本不一致/);
});

test("发布归档原样保留变更记录中的美元符号和替换模式", async (t) => {
  const dir = await fixture(t);
  const changes = "- 保留 $&、$`、$' 和 $HOME 等文本。";
  await writeFile(
    join(dir, "CHANGELOG.md"),
    `# 变更日志\n\n## 未发布\n\n${changes}\n`,
  );
  prepareVersion(dir, "patch");
  assert.ok(
    (await readFile(join(dir, "CHANGELOG.md"), "utf8")).includes(changes),
  );
  assert.ok(
    (await readFile(join(dir, "docs/releases/v1.2.4.md"), "utf8")).includes(
      changes,
    ),
  );
});

test("版本准备支持 patch、major 和明确的正式版本", async (t) => {
  for (const [target, expected] of [
    ["patch", "1.2.4"],
    ["major", "2.0.0"],
    ["3.1.4", "3.1.4"],
  ]) {
    const dir = await fixture(t);
    assert.equal(prepareVersion(dir, target), expected);
    assert.equal(checkVersions(dir), expected);
  }
});

test("同版本重试保持版本、发布说明和待发布变更原样", async (t) => {
  const dir = await fixture(t);
  initialize(dir);
  prepareVersion(dir, "1.2.4", "2026-10-26");
  const notesPath = join(dir, "docs/releases/v1.2.4.md");
  await writeFile(
    notesPath,
    "# Claudex Web v1.2.4\n\n- 已审阅的安装与升级说明。\n",
  );
  const changelogPath = join(dir, "CHANGELOG.md");
  await writeFile(
    changelogPath,
    (await readFile(changelogPath, "utf8")).replace(
      "## 未发布",
      "## 未发布\n\n- 后续积累的变更。",
    ),
  );
  const paths = [
    "package.json",
    "client/package.json",
    "server/package.json",
    "package-lock.json",
    "CHANGELOG.md",
    "docs/releases/v1.2.4.md",
    "README.md",
    "docs/deployment.md",
  ];
  const before = await Promise.all(
    paths.map((path) => readFile(join(dir, path), "utf8")),
  );
  assert.equal(prepareVersion(dir, "1.2.4", "2026-10-27"), "1.2.4");
  assert.deepEqual(
    await Promise.all(paths.map((path) => readFile(join(dir, path), "utf8"))),
    before,
  );
  assert.throws(() => prepareVersion(dir, "patch"), /继续完成该版本/);
  commit(dir);
  git(dir, "tag", "v1.2.4");
  assert.equal(checkRelease(dir, "v1.2.4"), "1.2.4");
  assert.equal(prepareVersion(dir, "1.2.4"), "1.2.4");
  assert.equal(git(dir, "status", "--porcelain"), "");
});
