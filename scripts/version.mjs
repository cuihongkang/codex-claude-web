import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readVersion } from "../server/src/version.mjs";

import { releaseVersion, compareReleaseVersions } from "./release-version.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

const emptyChanges = "### 新增\n\n### 改进\n\n### 修复\n\n### 维护\n";
const read = (dir, path) => readFileSync(join(dir, path), "utf8");
const json = (dir, path) => JSON.parse(read(dir, path));
const writeJson = (dir, path, value) =>
  writeFileSync(join(dir, path), JSON.stringify(value, null, 2) + "\n");

function manifests(dir) {
  const pkg = json(dir, "package.json");
  return ["", ...pkg.workspaces].map((workspace) => ({
    workspace,
    path: join(workspace, "package.json"),
    pkg: json(dir, join(workspace, "package.json")),
  }));
}

export function checkVersions(dir = root) {
  const packages = manifests(dir);
  const version = packages[0].pkg.version;
  assert.match(
    version,
    releaseVersion,
    "包版本使用 X.Y.Z 或 X.Y.Z-alpha.N、beta.N、rc.N 格式",
  );
  const lock = json(dir, "package-lock.json");
  assert.equal(lock.version, version, "锁文件顶层版本与根包不一致");
  for (const entry of packages) {
    assert.equal(entry.pkg.version, version, `${entry.path} 版本与根包不一致`);
    assert.equal(
      lock.packages[entry.workspace]?.version,
      version,
      `锁文件中的 ${entry.workspace || "根包"} 版本不一致`,
    );
  }
  assert.match(
    read(dir, "CHANGELOG.md"),
    /^## 未发布\s*$/m,
    "变更日志需要保留未发布区域",
  );
  return version;
}

export function prepareVersion(
  dir,
  target,
  date = new Date().toLocaleDateString("en-CA"),
) {
  const previous = checkVersions(dir);
  const parts = previous.split("-")[0].split(".").map(Number);
  const index = ["major", "minor", "patch"].indexOf(target);
  if (index >= 0) {
    parts[index]++;
    parts.fill(0, index + 1);
    target = parts.join(".");
  }
  assert.match(
    target || "",
    releaseVersion,
    "用法：npm run version:prepare -- patch|minor|major|X.Y.Z[-alpha.N|-beta.N|-rc.N]",
  );
  if (target === previous) {
    assert.ok(
      existsSync(join(dir, `docs/releases/v${target}.md`)) &&
        read(dir, "CHANGELOG.md").includes(`## [${target}] - `),
      `当前版本 ${target} 缺少发布准备记录`,
    );
    return target;
  }
  assert.ok(
    compareReleaseVersions(target, previous) > 0,
    "新版本必须大于当前版本",
  );
  if (existsSync(join(dir, ".git"))) {
    const currentTag = execFileSync("git", ["tag", "--list", `v${previous}`], {
      cwd: dir,
      encoding: "utf8",
    }).trim();
    assert.ok(
      currentTag || !existsSync(join(dir, `docs/releases/v${previous}.md`)),
      `v${previous} 已准备且尚未创建标签，请继续完成该版本；重试使用明确版本 ${previous}`,
    );
  }
  const tag = `v${target}`;
  assert.ok(
    !existsSync(join(dir, `docs/releases/${tag}.md`)),
    `${tag} 发布说明已经存在`,
  );
  if (existsSync(join(dir, ".git"))) {
    const tags = execFileSync("git", ["tag", "--list", tag], {
      cwd: dir,
      encoding: "utf8",
    }).trim();
    assert.equal(tags, "", `${tag} 标签已经存在`);
  }
  const changelog = read(dir, "CHANGELOG.md");
  const section = changelog.match(
    /^## 未发布\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m,
  );
  assert.ok(
    section && /^- \S/m.test(section[1]),
    "先在 CHANGELOG.md 的未发布区域记录本次变更",
  );
  const changes = section[1].trim();
  assert.ok(
    !changelog.includes(`## [${target}]`),
    `${target} 变更记录已经存在`,
  );
  const docs = ["README.md", "docs/deployment.md"].map((path) => ({
    path,
    content: read(dir, path)
      .replaceAll(`v${previous}`, tag)
      .replaceAll(`claudex-web-${previous}.tgz`, `claudex-web-${target}.tgz`)
      .replace(
        `npm install -g ./claudex-web-${target}.tgz`,
        `npm install -g https://github.com/hjd-hitsz/claudex-web/releases/download/${tag}/claudex-web-${target}.tgz`,
      ),
  }));
  if (target.includes("-")) {
    for (const doc of docs) {
      const original = previous.includes("-")
        ? doc.content
        : read(dir, doc.path);
      const preview = `<!-- prerelease:start -->\n预发布版 [${tag}](https://github.com/hjd-hitsz/claudex-web/releases/tag/${tag}) 供主动选择测试通道的使用者安装，后续持续迭代。\n\n\`\`\`bash\nnpm install -g https://github.com/hjd-hitsz/claudex-web/releases/download/${tag}/claudex-web-${target}.tgz\n\`\`\`\n<!-- prerelease:end -->`;
      doc.content = original.includes("<!-- prerelease:start -->")
        ? original.replace(
            /<!-- prerelease:start -->[\s\S]*?<!-- prerelease:end -->/,
            () => preview,
          )
        : original.replace(
            /(## (?:快速开始|安装发行包)\n)/,
            (heading) => heading + "\n" + preview + "\n",
          );
    }
  }
  if (!target.includes("-")) {
    for (const doc of docs)
      doc.content = doc.content.replace(
        /<!-- prerelease:start -->[\s\S]*?<!-- prerelease:end -->/,
        () =>
          `稳定版 [${tag}](https://github.com/hjd-hitsz/claudex-web/releases/tag/${tag})：\n\n\`\`\`bash\nnpm install -g https://github.com/hjd-hitsz/claudex-web/releases/download/${tag}/claudex-web-${target}.tgz\n\`\`\``,
      );
  }
  const packages = manifests(dir);
  const lock = json(dir, "package-lock.json");
  for (const entry of packages) {
    entry.pkg.version = target;
    lock.packages[entry.workspace].version = target;
  }
  lock.version = target;
  for (const entry of packages) writeJson(dir, entry.path, entry.pkg);
  writeJson(dir, "package-lock.json", lock);
  writeFileSync(
    join(dir, "CHANGELOG.md"),
    changelog.replace(
      section[0],
      () =>
        `## 未发布\n\n${emptyChanges}\n## [${target}] - ${date}\n\n${changes}\n\n`,
    ),
  );
  writeFileSync(
    join(dir, `docs/releases/${tag}.md`),
    `# Claudex Web ${tag}\n\n${changes}\n`,
  );
  for (const doc of docs) writeFileSync(join(dir, doc.path), doc.content);
  return target;
}

export function checkRelease(dir = root, tag = process.env.GITHUB_REF_NAME) {
  const version = checkVersions(dir);
  tag ||= `v${version}`;
  assert.equal(tag, `v${version}`, "发布标签必须匹配根包版本");
  assert.ok(existsSync(join(dir, ".git")), "发布检查需要在 Git 源码仓库中执行");
  const info = readVersion(dir);
  assert.equal(
    info.channel,
    "release",
    "发布需要干净的 Git 工作区，并在 HEAD 上创建匹配版本的标签",
  );
  const notes = read(dir, `docs/releases/${tag}.md`);
  assert.ok(
    notes.startsWith(`# Claudex Web ${tag}\n`),
    "发布说明标题需要匹配版本",
  );
  assert.ok(/^- \S/m.test(notes), "发布说明需要包含实际变更");
  assert.ok(
    read(dir, "CHANGELOG.md").includes(`## [${version}] - `),
    "变更日志缺少本次版本记录",
  );
  for (const path of ["README.md", "docs/deployment.md"])
    assert.ok(
      read(dir, path).includes(
        `releases/download/${tag}/claudex-web-${version}.tgz`,
      ),
      `${path} 安装链接需要更新到 ${tag}`,
    );
  return version;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    switch (process.argv[2]) {
      case "check":
        console.log(`版本一致性检查通过：${checkVersions()}`);
        break;
      case "prepare":
        console.log(
          `已准备 ${prepareVersion(root, process.argv[3])}，请审阅变更与发布说明，再执行 npm run check。提交后创建标签并执行 npm run release:check。`,
        );
        break;
      case "release":
        console.log(`发布检查通过：v${checkRelease(root, process.argv[3])}`);
        break;
      default:
        throw new Error("版本命令：check | prepare <版本> | release [标签]");
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
