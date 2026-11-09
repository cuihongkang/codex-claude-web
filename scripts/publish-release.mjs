import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkRelease } from "./version.mjs";

import { releaseVersion, releaseFlags } from "./release-version.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const gh = (...args) =>
  execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

function findRelease(repo, tag, run) {
  const releases = JSON.parse(
    run("api", `repos/${repo}/releases?per_page=100`, "--paginate", "--slurp"),
  ).flat();
  return releases.find((release) => release.tag_name === tag);
}

function checkAssets(release, names) {
  for (const name of names)
    assert.ok(
      release.assets.some(
        (asset) =>
          asset.name === name && asset.state === "uploaded" && asset.size > 0,
      ),
      `${release.tag_name} 缺少附件 ${name}，请核查已交付内容`,
    );
}

export function releaseNotesBody(markdown, tag) {
  const heading = markdown.startsWith(`# Codex Web ${tag}\n`)
    ? `# Codex Web ${tag}\n`
    : `# Claudex Web ${tag}\n`;
  assert.ok(markdown.startsWith(heading), `${tag} 发布说明标题需要匹配版本`);
  const body = markdown.slice(heading.length).trim();
  assert.match(body, /^- \S/, `${tag} Release 正文需要直接以变更列表开始`);
  return `${body}\n`;
}

export function syncReleaseNotes(repo, run = gh, dir = root) {
  const releases = JSON.parse(
    run("api", `repos/${repo}/releases?per_page=100`, "--paginate", "--slurp"),
  ).flat();
  const temporary = mkdtempSync(join(tmpdir(), "claudex-web-release-notes-"));
  try {
    for (const release of releases) {
      const tag = release.tag_name;
      if (!releaseVersion.test(tag.slice(1))) continue;
      const source = join(dir, `docs/releases/${tag}.md`);
      if (!existsSync(source)) continue;
      const body = releaseNotesBody(readFileSync(source, "utf8"), tag);
      if (release.body?.trim() === body.trim()) continue;
      const notes = join(temporary, `${tag}.md`);
      writeFileSync(notes, body);
      run("release", "edit", tag, "--repo", repo, "--notes-file", notes);
      console.log(`${tag} Release 正文已同步，直接显示变更列表`);
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

export function readReleaseSchedule(dir = root) {
  const path = join(dir, ".github/release-schedule.json");
  const schedule = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8"))
    : {};
  assert.ok(
    schedule && typeof schedule === "object" && !Array.isArray(schedule),
  );
  for (const [tag, publishAt] of Object.entries(schedule)) {
    assert.ok(tag.startsWith("v") && releaseVersion.test(tag.slice(1)));
    assert.ok(
      typeof publishAt === "string" &&
        /T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/.test(publishAt) &&
        Number.isFinite(Date.parse(publishAt)),
      `${tag} 发布时间需要使用含时区的 ISO 8601 时间`,
    );
  }
  return schedule;
}

export function publishRelease(
  repo,
  tag,
  assets,
  notes,
  run = gh,
  draft = false,
) {
  const existing = findRelease(repo, tag, run);
  if (existing && !existing.draft) {
    checkAssets(
      existing,
      assets.map((path) => basename(path)),
    );
    return "published";
  }
  if (!existing)
    run(
      "release",
      "create",
      tag,
      "--repo",
      repo,
      "--verify-tag",
      "--draft",
      ...releaseFlags(tag),
      "--title",
      `Claudex Web ${tag}`,
      "--notes-file",
      notes,
    );
  run("release", "upload", tag, ...assets, "--repo", repo, "--clobber");
  if (draft) return "draft";
  run(
    "release",
    "edit",
    tag,
    "--repo",
    repo,
    "--title",
    `Claudex Web ${tag}`,
    "--notes-file",
    notes,
    "--draft=false",
    ...releaseFlags(tag),
  );
  return "published";
}

export function verifyReleaseAssets(repo, tag, run = gh) {
  const dir = mkdtempSync(join(tmpdir(), "claudex-web-release-verify-"));
  try {
    const filename = `claudex-web-${tag.slice(1)}.tgz`;
    run(
      "release",
      "download",
      tag,
      "--repo",
      repo,
      "--dir",
      dir,
      "--pattern",
      filename,
      "--pattern",
      `${filename}.sha256`,
    );
    const checksum = createHash("sha256")
      .update(readFileSync(join(dir, filename)))
      .digest("hex");
    assert.equal(
      readFileSync(join(dir, `${filename}.sha256`), "utf8").trim(),
      `${checksum}  ${filename}`,
      `${tag} 下载附件的 SHA-256 校验失败`,
    );
    const prefix = join(dir, "install");
    execFileSync(
      "npm",
      [
        "install",
        "--global",
        "--prefix",
        prefix,
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        join(dir, filename),
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const info = JSON.parse(
      execFileSync(join(prefix, "bin/claudex-web"), ["version", "--json"], {
        encoding: "utf8",
      }),
    );
    const revision = execFileSync("git", ["rev-parse", `${tag}^{commit}`], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    assert.equal(info.version, tag.slice(1));
    assert.equal(info.revision, revision);
    assert.equal(info.channel, "release");
    assert.equal(info.dirty, false);
    console.log(`${tag} 附件下载、SHA-256 与临时全局安装验证通过`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function publishScheduledRelease(
  repo,
  tag,
  publishAt,
  { run = gh, now = Date.now(), verify = verifyReleaseAssets } = {},
) {
  assert.ok(Number.isFinite(Date.parse(publishAt)), "发布时间无效");
  if (now < Date.parse(publishAt)) return "pending";
  const release = findRelease(repo, tag, run);
  assert.ok(release, `${tag} 的发布草稿尚未准备完成`);
  const filename = `claudex-web-${tag.slice(1)}.tgz`;
  checkAssets(release, [filename, `${filename}.sha256`]);
  if (!release.draft) return "published";
  verify(repo, tag, run);
  run(
    "release",
    "edit",
    tag,
    "--repo",
    repo,
    "--draft=false",
    ...releaseFlags(tag),
  );
  return "published";
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const repo = process.env.GITHUB_REPOSITORY;
  assert.ok(repo, "发布需要 GITHUB_REPOSITORY");
  if (process.argv[2] === "--sync-notes") {
    syncReleaseNotes(repo);
    process.exit(0);
  }
  const schedule = readReleaseSchedule();
  if (process.argv[2] === "--scheduled") {
    for (const [tag, publishAt] of Object.entries(schedule)) {
      const result = publishScheduledRelease(repo, tag, publishAt);
      console.log(`${tag}：${result}，计划发布时间 ${publishAt}`);
    }
    process.exit(0);
  }
  const dir = mkdtempSync(join(tmpdir(), "claudex-web-release-"));
  try {
    const version = checkRelease();
    const [pack] = JSON.parse(
      execFileSync(
        "npm",
        ["pack", "--ignore-scripts", "--json", "--pack-destination", dir],
        { cwd: root, encoding: "utf8" },
      ),
    );
    const path = join(dir, pack.filename);
    const checksum = createHash("sha256")
      .update(readFileSync(path))
      .digest("hex");
    writeFileSync(`${path}.sha256`, `${checksum}  ${pack.filename}\n`);
    const tag = `v${version}`;
    const notes = join(dir, "release-notes.md");
    writeFileSync(
      notes,
      releaseNotesBody(
        readFileSync(join(root, `docs/releases/${tag}.md`), "utf8"),
        tag,
      ),
    );
    const result = publishRelease(
      repo,
      tag,
      [path, `${path}.sha256`],
      notes,
      gh,
      Object.hasOwn(schedule, tag),
    );
    verifyReleaseAssets(repo, tag);
    console.log(
      result === "draft"
        ? `${tag} 草稿及附件已就绪，计划于 ${schedule[tag]} 发布`
        : `发布完成：https://github.com/${repo}/releases/tag/${tag}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
