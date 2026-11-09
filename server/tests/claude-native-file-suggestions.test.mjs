import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClaudeCatalogue } from "../src/backends/claude/catalogue.mjs";

test("原生文件建议复用所属会话并保持原生排序与目录类型", async () => {
  const calls = [];
  const native = (name) => ({
    initializationResult: async () => ({}),
    request: async (request) => {
      calls.push({ name, request });
      return {
        response: {
          cwd: "/workspace",
          suggestions: [{ path: "目录/" }, { path: "src/文件.ts" }],
        },
      };
    },
  });
  const catalogue = createClaudeCatalogue({
    backend: { id: "claude", dataDir: "/native/claude" },
    providers: { get: async (_backend, id) => ({ id, models: ["fixture"] }) },
    queries: new Map([
      [
        "other",
        { cwd: "/workspace", providerId: "other", query: native("wrong") },
      ],
      [
        "selected",
        { cwd: "/workspace", providerId: "right", query: native("selected") },
      ],
    ]),
  });
  try {
    assert.deepEqual(
      await catalogue.fileSuggestions({
        cwd: "/workspace",
        providerId: "right",
        threadId: "selected",
        query: "文件",
      }),
      {
        files: [
          {
            root: "/workspace",
            path: "目录",
            file_name: "目录",
            match_type: "directory",
          },
          {
            root: "/workspace",
            path: "src/文件.ts",
            file_name: "文件.ts",
            match_type: "file",
          },
        ],
      },
    );
    assert.deepEqual(calls, [
      {
        name: "selected",
        request: { subtype: "file_suggestions", query: "文件" },
      },
    ]);
  } finally {
    catalogue.close();
  }
});

test(
  "真实Claude Code通过原生control返回文件、目录和模糊建议",
  { skip: !process.env.CLAUDE_EXECUTABLE },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "claude-native-files-"));
    const cwd = join(root, "project");
    await mkdir(join(cwd, "native-target"), { recursive: true });
    await writeFile(join(cwd, "native-target", "FileSearch.ts"), "fixture");
    await mkdir(join(cwd, ".claude", "skills", "native-fixture"), {
      recursive: true,
    });
    await writeFile(
      join(cwd, ".claude", "skills", "native-fixture", "SKILL.md"),
      "---\nname: native-fixture\ndescription: >\n  Native multiline\n  skill description\n---\nFixture body\n",
    );
    const catalogue = createClaudeCatalogue({
      backend: {
        id: "claude",
        dataDir: join(root, "config"),
        stateDir: join(root, "web-state"),
        executable: process.env.CLAUDE_EXECUTABLE,
      },
      providers: { get: async () => null },
    });
    t.after(async () => {
      catalogue.close();
      await rm(root, { recursive: true, force: true });
    });
    const list = (query) =>
      catalogue.fileSuggestions({ cwd, providerId: "", query });
    const top = await list("");
    assert.ok(
      top.files.some(
        (file) =>
          file.path === "native-target" && file.match_type === "directory",
      ),
    );
    let found;
    // Native indexing runs asynchronously; wait for its observable search result.
    const deadline = Date.now() + 5000;
    do {
      found = await list("fs");
      if (
        found.files.some((file) => file.path === "native-target/FileSearch.ts")
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    assert.ok(
      found.files.some(
        (file) =>
          file.path === "native-target/FileSearch.ts" &&
          file.match_type === "file",
      ),
    );
    const binary = Buffer.alloc(1_100_003, 0xff);
    await writeFile(join(cwd, "binary.bin"), binary);
    const file = await catalogue.readFile(
      { cwd, providerId: "" },
      join(cwd, "binary.bin"),
    );
    assert.deepEqual(Buffer.from(file.dataBase64, "base64"), binary);
    await writeFile(
      join(cwd, "over-native-limit.bin"),
      Buffer.alloc(10_000_001),
    );
    await assert.rejects(
      catalogue.readFile(
        { cwd, providerId: "" },
        join(cwd, "over-native-limit.bin"),
      ),
      /10 MB/,
    );
    const skills = await catalogue.skills({ cwd, providerId: "" });
    const skill = skills.find((row) => row.name === "native-fixture");
    assert.ok(skill);
    assert.match(skill.description, /Native multiline\s+skill description/);
    assert.ok(skills.some((row) => row.builtin === true));
    const usage = await catalogue.usage({ cwd, providerId: "" });
    assert.equal(usage.rate_limits_available, false);
    assert.equal(usage.rate_limits, null);
    assert.equal(usage.behaviors, null);
    assert.equal(usage.session.total_cost_usd, 0);
    const settings = await catalogue.settings({ cwd, providerId: "" });
    assert.equal(typeof settings.applied.model, "string");
    assert.ok(Array.isArray(settings.sources));
    const hooks = await catalogue.hookListing({ cwd, providerId: "" });
    assert.ok(Array.isArray(hooks.events));
    assert.ok(Array.isArray(hooks.hooks));
    assert.equal(typeof hooks.policy.allDisabled, "boolean");
  },
);
