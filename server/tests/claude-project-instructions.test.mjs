import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readProjectInstructions } from "../src/backends/claude/project-instructions.mjs";

test("project instructions preserve ancestor order, full contents and specific scopes", async () => {
  const root = await mkdtemp(join(tmpdir(), "claude-project-rules-"));
  const cwd = join(root, "中文 project", "child");
  try {
    await mkdir(cwd, { recursive: true });
    const parentText = "ROOT_MARKER\n  trailing spaces  \n\n";
    const overrideText = "CHILD_OVERRIDE\n更具体的规则。\n";
    await writeFile(join(root, "AGENTS.md"), parentText);
    await writeFile(join(cwd, "AGENTS.md"), "SHADOWED_RULES");
    await writeFile(join(cwd, "AGENTS.override.md"), overrideText);
    await writeFile(join(cwd, "CLAUDE.md"), "NATIVE_CLAUDE_OWNED");
    const context = await readProjectInstructions(cwd);
    assert.ok(context.indexOf(parentText) < context.indexOf(overrideText));
    assert.ok(context.includes(parentText));
    assert.ok(context.includes(overrideText));
    assert.ok(context.includes(JSON.stringify(join(root, "AGENTS.md"))));
    assert.ok(
      context.includes(JSON.stringify(join(cwd, "AGENTS.override.md"))),
    );
    assert.ok(context.includes(`适用范围：${JSON.stringify(root)}`));
    assert.ok(!context.includes("SHADOWED_RULES"));
    assert.ok(!context.includes("NATIVE_CLAUDE_OWNED"));
    await writeFile(join(cwd, "AGENTS.override.md"), "");
    assert.ok(!(await readProjectInstructions(cwd)).includes("SHADOWED_RULES"));
    await rm(join(cwd, "AGENTS.override.md"));
    assert.ok((await readProjectInstructions(cwd)).includes("SHADOWED_RULES"));
    await writeFile(join(cwd, "AGENTS.md"), "UPDATED_EACH_SUBMISSION");
    assert.ok(
      (await readProjectInstructions(cwd)).includes("UPDATED_EACH_SUBMISSION"),
    );
    await rm(join(cwd, "AGENTS.md"));
    assert.ok(
      !(await readProjectInstructions(cwd)).includes("UPDATED_EACH_SUBMISSION"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a selected instruction read failure reports its actual path and blocks fallback", async () => {
  const root = await mkdtemp(join(tmpdir(), "claude-project-rules-error-"));
  try {
    const path = join(root, "AGENTS.override.md");
    await mkdir(path);
    await writeFile(join(root, "AGENTS.md"), "MUST_NOT_FALLBACK");
    await assert.rejects(
      readProjectInstructions(root),
      (error) => error.message.includes(path) && error.cause?.code === "EISDIR",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
