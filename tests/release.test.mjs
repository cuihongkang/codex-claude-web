import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  publishRelease,
  publishScheduledRelease,
  readReleaseSchedule,
  releaseNotesBody,
  syncReleaseNotes,
} from "../scripts/publish-release.mjs";

const repo = "example/claudex-web";
const tag = "v1.2.3";
const assets = [
  "/tmp/claudex-web-1.2.3.tgz",
  "/tmp/claudex-web-1.2.3.tgz.sha256",
];
const notes = "docs/releases/v1.2.3.md";

function registry() {
  const state = {
    releases: [],
    mutations: [],
    failUpload: false,
    failPublishResponse: false,
  };
  state.run = (...args) => {
    if (args[0] === "api") {
      assert.deepEqual(args, [
        "api",
        `repos/${repo}/releases?per_page=100`,
        "--paginate",
        "--slurp",
      ]);
      return JSON.stringify([state.releases]);
    }
    assert.equal(args[0], "release");
    assert.equal(args[2], tag);
    assert.equal(args[args.indexOf("--repo") + 1], repo);
    state.mutations.push(args[1]);
    let release = state.releases.find((item) => item.tag_name === tag);
    if (args[1] === "create") {
      assert.equal(release, undefined);
      assert.ok(args.includes("--draft"));
      assert.ok(args.includes("--verify-tag"));
      state.releases.push({ tag_name: tag, draft: true, assets: [] });
    } else if (args[1] === "upload") {
      assert.equal(release.draft, true);
      assert.ok(args.includes("--clobber"));
      for (const path of args.slice(3, args.indexOf("--repo"))) {
        const name = basename(path);
        release.assets = release.assets.filter((item) => item.name !== name);
        release.assets.push({ name, state: "uploaded", size: 123 });
        if (state.failUpload) {
          state.failUpload = false;
          throw new Error("附件上传中断");
        }
      }
    } else if (args[1] === "edit") {
      assert.equal(release.assets.length, 2);
      assert.ok(args.includes("--draft=false"));
      assert.ok(args.includes("--latest"));
      if (args.includes("--notes-file"))
        assert.equal(args[args.indexOf("--notes-file") + 1], notes);
      release.draft = false;
      if (state.failPublishResponse) {
        state.failPublishResponse = false;
        throw new Error("发布成功后连接中断");
      }
    } else {
      assert.fail(`意外的写入：${args.join(" ")}`);
    }
    return "";
  };
  return state;
}

test("附件部分上传失败后重试同一草稿，完整上传后发布", () => {
  const state = registry();
  state.failUpload = true;
  assert.throws(
    () => publishRelease(repo, tag, assets, notes, state.run),
    /上传中断/,
  );
  assert.equal(state.releases[0].draft, true);
  assert.equal(state.releases[0].assets.length, 1);
  publishRelease(repo, tag, assets, notes, state.run);
  assert.equal(state.releases.length, 1);
  assert.equal(state.releases[0].tag_name, tag);
  assert.equal(state.releases[0].draft, false);
  assert.deepEqual(
    state.releases[0].assets.map((item) => item.name),
    assets.map((path) => basename(path)),
  );
  assert.deepEqual(state.mutations, ["create", "upload", "upload", "edit"]);
});

test("发布成功但响应中断后重试，保留正式附件和发布记录", () => {
  const state = registry();
  state.failPublishResponse = true;
  assert.throws(
    () => publishRelease(repo, tag, assets, notes, state.run),
    /连接中断/,
  );
  const published = structuredClone(state.releases);
  state.mutations.length = 0;
  publishRelease(repo, tag, assets, notes, state.run);
  assert.deepEqual(state.releases, published);
  assert.deepEqual(state.mutations, []);
});

test("正式版本缺少附件和 GitHub 查询失败时保持现场并报错", () => {
  const state = registry();
  state.releases.push({ tag_name: tag, draft: false, assets: [] });
  assert.throws(
    () => publishRelease(repo, tag, assets, notes, state.run),
    /缺少附件/,
  );
  assert.deepEqual(state.mutations, []);
  assert.throws(
    () =>
      publishRelease(repo, tag, assets, notes, () => {
        throw new Error("GitHub 暂不可用");
      }),
    /GitHub 暂不可用/,
  );
  assert.deepEqual(state.mutations, []);
});

test("定时版本提前上传完整附件并保持同版本草稿，重试继续保留草稿", () => {
  const state = registry();
  for (let attempt = 0; attempt < 2; attempt++)
    assert.equal(
      publishRelease(repo, tag, assets, notes, state.run, true),
      "draft",
    );
  assert.equal(state.releases.length, 1);
  assert.equal(state.releases[0].draft, true);
  assert.equal(state.releases[0].assets.length, 2);
  assert.deepEqual(state.mutations, ["create", "upload", "upload"]);
});

const publishAt = "2026-10-29T09:00:00+08:00";
const due = Date.parse("2026-10-29T01:00:00Z");

test("定时发布按时区检查目标时间，提前检查和手动重试均不访问发布接口", () => {
  const unexpected = () => assert.fail("目标时间之前应保持草稿");
  assert.equal(
    publishScheduledRelease(repo, tag, publishAt, {
      now: due - 1,
      run: unexpected,
      verify: unexpected,
    }),
    "pending",
  );
});

test("到期后先验证下载附件，再公开已有草稿且保留发布正文", () => {
  const state = registry();
  publishRelease(repo, tag, assets, notes, state.run, true);
  state.mutations.length = 0;
  assert.equal(
    publishScheduledRelease(repo, tag, publishAt, {
      now: due,
      run: state.run,
      verify: (actualRepo, actualTag) => {
        assert.equal(actualRepo, repo);
        assert.equal(actualTag, tag);
        assert.equal(state.releases[0].draft, true);
        state.mutations.push("verify");
      },
    }),
    "published",
  );
  assert.equal(state.releases[0].draft, false);
  assert.deepEqual(state.mutations, ["verify", "edit"]);
});

test("草稿缺失、附件不完整或下载验证失败时保留现场，随后可按原版本重试", () => {
  const state = registry();
  const options = { now: due, run: state.run, verify: () => {} };
  assert.throws(
    () => publishScheduledRelease(repo, tag, publishAt, options),
    /草稿尚未准备完成/,
  );
  state.failUpload = true;
  assert.throws(
    () => publishRelease(repo, tag, assets, notes, state.run, true),
    /上传中断/,
  );
  state.mutations.length = 0;
  assert.throws(
    () => publishScheduledRelease(repo, tag, publishAt, options),
    /缺少附件/,
  );
  assert.deepEqual(state.mutations, []);
  publishRelease(repo, tag, assets, notes, state.run, true);
  state.mutations.length = 0;
  assert.throws(
    () =>
      publishScheduledRelease(repo, tag, publishAt, {
        ...options,
        verify: () => {
          throw new Error("下载校验失败");
        },
      }),
    /下载校验失败/,
  );
  assert.equal(state.releases[0].draft, true);
  assert.deepEqual(state.mutations, []);
  publishScheduledRelease(repo, tag, publishAt, options);
  assert.equal(state.releases[0].draft, false);
  assert.equal(state.releases[0].tag_name, tag);
});

test("定时发布响应中断后重试保留已发布附件，后续调度只读取完整性", () => {
  const state = registry();
  publishRelease(repo, tag, assets, notes, state.run, true);
  state.failPublishResponse = true;
  const options = { now: due, run: state.run, verify: () => {} };
  assert.throws(
    () => publishScheduledRelease(repo, tag, publishAt, options),
    /连接中断/,
  );
  const published = structuredClone(state.releases);
  state.mutations.length = 0;
  publishScheduledRelease(repo, tag, publishAt, {
    ...options,
    verify: () => assert.fail("已发布附件应保持固定"),
  });
  assert.deepEqual(state.releases, published);
  assert.deepEqual(state.mutations, []);
});

test("发布计划要求明确版本和含时区时间，缺少配置时沿用即时发布", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "claudex-web-schedule-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(readReleaseSchedule(dir), {});
  mkdirSync(join(dir, ".github"));
  const path = join(dir, ".github/release-schedule.json");
  writeFileSync(path, JSON.stringify({ [tag]: publishAt }));
  assert.deepEqual(readReleaseSchedule(dir), { [tag]: publishAt });
  for (const value of ["2026-10-29T09:00:00", "明天九点", null]) {
    writeFileSync(path, JSON.stringify({ [tag]: value }));
    assert.throws(() => readReleaseSchedule(dir), /含时区/);
  }
  writeFileSync(path, JSON.stringify({ latest: publishAt }));
  assert.throws(() => readReleaseSchedule(dir));
});

test("Release 正文直接从列表开始，独立文档的标题和变更链接保持完整", () => {
  const list =
    "- 新增消息目录（[abc1234](https://example.test/commit/abc1234)）。\n";
  const document = `# Claudex Web ${tag}\n\n${list}`;
  assert.equal(releaseNotesBody(document, tag), list);
  assert.ok(document.startsWith(`# Claudex Web ${tag}`));
  assert.throws(() => releaseNotesBody(document, "v9.9.9"), /标题/);
  assert.throws(
    () => releaseNotesBody(`# Claudex Web ${tag}\n\n## 概述\n`, tag),
    /变更列表/,
  );
});

test("同步历史 Release 仅更新正文，保留标题、标签和附件，重复同步省去写入", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "claudex-web-notes-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "docs/releases"), { recursive: true });
  const document = `# Claudex Web ${tag}\n\n- 查看文件变更。\n`;
  writeFileSync(join(dir, `docs/releases/${tag}.md`), document);
  const release = {
    tag_name: tag,
    name: `Claudex Web ${tag}`,
    draft: false,
    assets: [{ name: "已发布附件", size: 123 }],
    body: document,
  };
  const original = structuredClone(release);
  let writes = 0;
  const run = (...args) => {
    if (args[0] === "api") return JSON.stringify([[release]]);
    assert.deepEqual(args.slice(0, 6), [
      "release",
      "edit",
      tag,
      "--repo",
      repo,
      "--notes-file",
    ]);
    assert.equal(args.length, 7);
    release.body = readFileSync(args[6], "utf8");
    writes++;
  };
  syncReleaseNotes(repo, run, dir);
  assert.equal(release.body, "- 查看文件变更。\n");
  assert.deepEqual({ ...release, body: original.body }, original);
  assert.equal(
    readFileSync(join(dir, `docs/releases/${tag}.md`), "utf8"),
    document,
  );
  syncReleaseNotes(repo, run, dir);
  assert.equal(writes, 1);
});

test("beta 发布和同版本重试保持预发布标记及稳定版 Latest", () => {
  const previewTag = "v4.0.0-beta.1";
  const previewAssets = assets.map((path) =>
    path.replaceAll("1.2.3", "4.0.0-beta.1"),
  );
  const records = [];
  const calls = [];
  let failed = false;
  const run = (...args) => {
    if (args[0] === "api") return JSON.stringify([records]);
    calls.push(args);
    if (args[1] === "create") {
      assert.ok(args.includes("--prerelease"));
      assert.ok(args.includes("--latest=false"));
      records.push({
        tag_name: previewTag,
        draft: true,
        prerelease: true,
        assets: [],
      });
    }
    if (args[1] === "upload") {
      if (!failed) {
        failed = true;
        throw new Error("中断");
      }
      records[0].assets = previewAssets.map((path) => ({
        name: basename(path),
        state: "uploaded",
        size: 123,
      }));
    }
    if (args[1] === "edit") {
      assert.ok(args.includes("--prerelease"));
      assert.ok(args.includes("--latest=false"));
      records[0].draft = false;
    }
    return "";
  };
  assert.throws(
    () => publishRelease(repo, previewTag, previewAssets, notes, run),
    /中断/,
  );
  assert.equal(
    publishRelease(repo, previewTag, previewAssets, notes, run),
    "published",
  );
  const count = calls.length;
  assert.equal(
    publishRelease(repo, previewTag, previewAssets, notes, run),
    "published",
  );
  assert.equal(calls.length, count);
  assert.equal(records[0].prerelease, true);
});
