import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execute = promisify(execFile);
export async function snapshotToolWorkspace(cwd) {
  let root;
  try {
    root = (
      await execute("git", ["rev-parse", "--show-toplevel"], { cwd })
    ).stdout.trim();
  } catch (error) {
    if (error.code === 128) return null;
    throw error;
  }
  const directory = await mkdtemp(join(tmpdir(), "claude-tool-index-"));
  const env = { ...process.env, GIT_INDEX_FILE: join(directory, "index") };
  const git = async (args) =>
    (
      await execute("git", args, {
        cwd: root,
        env,
        maxBuffer: 64 * 1024 * 1024,
      })
    ).stdout;
  try {
    await git(["read-tree", "--empty"]);
    await git(["add", "--all", "--", "."]);
    const before = (await git(["write-tree"])).trim();
    return {
      async changes() {
        await git(["add", "--all", "--", "."]);
        const after = (await git(["write-tree"])).trim();
        const names = (
          await git([
            "diff",
            "--no-renames",
            "--name-status",
            "-z",
            before,
            after,
          ])
        ).split("\0");
        const changes = [];
        for (let i = 0; i + 1 < names.length; i += 2) {
          const status = names[i],
            path = names[i + 1];
          const diff = await git([
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--no-renames",
            before,
            after,
            "--",
            path,
          ]);
          changes.push({
            path: join(root, path),
            kind: {
              type:
                status === "A" ? "add" : status === "D" ? "delete" : "update",
            },
            diff,
          });
        }
        return changes;
      },
      close: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
