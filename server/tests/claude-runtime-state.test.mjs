import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStorage } from "../src/backends/storage.mjs";
import { createBackgroundTasks } from "../src/backends/claude/background-tasks.mjs";
import { createClaudeRuntime } from "../src/backends/claude/runtime.mjs";
import { createCompactions } from "../src/compaction.mjs";
import { captureNativeProcesses } from "../src/backends/claude/process-ownership.mjs";

test("未知后台任务依据真实进程身份更新结束状态并保留仍存活任务", async () => {
  const dir = await mkdtemp(join(tmpdir(), "claude-orphan-query-"));
  try {
    const { owner } = await captureNativeProcesses(process.pid);
    const task = (id, nativeProcess) => ({
      task_id: id,
      task_type: "local_bash",
      is_backgrounded: true,
      status: "unknown",
      nativeProcess,
    });
    const storage = createStorage(join(dir, "state.json"), {
      sessions: {
        thread: {
          cwd: dir,
          backgroundTasks: {
            ended: task("ended", {
              pid: 2147483647,
              startTime: "0",
              bootId: "missing",
            }),
            live: task("live", owner),
          },
        },
      },
    });
    const save = (id, change) =>
      storage.update((data) => ({
        ...data,
        sessions: { ...data.sessions, [id]: change(data.sessions[id]) },
      }));
    const tasks = createBackgroundTasks({ storage, save, emit() {} });
    const result = await tasks.handlers.get("thread/backgroundTerminals/list")({
      threadId: "thread",
    });
    assert.deepEqual(
      result.data.map((task) => task.processId),
      ["live"],
    );
    assert.equal(
      (await storage.read()).sessions.thread.backgroundTasks.ended.status,
      "stopped",
    );
    assert.equal(
      (await storage.read()).sessions.thread.backgroundTasks.live.status,
      "unknown",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("后台终端分页查询与停止全部任务跨越100项分页边界", async () => {
  const dir = await mkdtemp(join(tmpdir(), "claude-task-pages-"));
  try {
    const storage = createStorage(join(dir, "state.json"), {
      sessions: { thread: { cwd: dir } },
    });
    const save = (id, change) =>
      storage.update((data) => ({
        ...data,
        sessions: { ...data.sessions, [id]: change(data.sessions[id]) },
      }));
    const tasks = createBackgroundTasks({ storage, save, emit() {} });
    const stopped = [];
    const process = { query: { stopTask: async (id) => stopped.push(id) } };
    await tasks.event(
      "thread",
      {
        type: "system",
        subtype: "background_tasks_changed",
        tasks: Array.from({ length: 125 }, (_, i) => ({
          task_id: `task-${i}`,
          task_type: "local_bash",
          description: `任务 ${i}`,
        })),
      },
      process,
    );
    const list = tasks.handlers.get("thread/backgroundTerminals/list");
    const first = await list({ threadId: "thread", limit: 100 });
    assert.equal(first.data.length, 100);
    const second = await list({
      threadId: "thread",
      cursor: first.nextCursor,
      limit: 100,
    });
    assert.equal(second.data.length, 25);
    assert.equal(second.nextCursor, null);
    await tasks.handlers.get("thread/backgroundTerminals/clean")({
      threadId: "thread",
    });
    assert.equal(stopped.length, 125);
    assert.equal((await list({ threadId: "thread" })).data.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("桥接恢复保留不确定输入并暂停持续目标，避免重新执行未确认请求", async () => {
  const dir = await mkdtemp(join(tmpdir(), "claude-runtime-recover-"));
  try {
    const storage = createStorage(join(dir, "state.json"), {
      sessions: {
        thread: {
          id: "thread",
          cwd: dir,
          active: { id: "active", input: [{ type: "text", text: "已发送" }] },
          queue: [{ id: "queued", input: [{ type: "text", text: "未确认" }] }],
          turns: { active: { id: "active", status: "inProgress" } },
          goal: { id: "goal", status: "active", objective: "持续任务" },
        },
      },
    });
    const runtime = createClaudeRuntime({
      backend: { dataDir: dir },
      storage,
      providers: {},
      broadcast() {},
      compactions: createCompactions(() => {}),
      questions: new Map(),
    });
    await runtime.recover();
    const session = (await storage.read()).sessions.thread;
    assert.equal(session.active, null);
    assert.equal(session.turns.active.status, "interrupted");
    assert.equal(session.goal.status, "paused");
    assert.deepEqual(
      session.queue.map((entry) => [entry.id, entry.status]),
      [
        ["active", "uncertain"],
        ["queued", "uncertain"],
      ],
    );
    assert.equal(runtime.queries.size, 0);
    runtime.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Bash工作树快照只包含本次工具边界内差异并保留用户已有修改及真实索引", async () => {
  const { snapshotToolWorkspace } =
    await import("../src/backends/claude/git-tool-changes.mjs");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { writeFile, readFile } = await import("node:fs/promises");
  const execute = promisify(execFile);
  const dir = await mkdtemp(join(tmpdir(), "claude-tool-git-"));
  let snapshot;
  try {
    await execute("git", ["init", "--quiet"], { cwd: dir });
    await writeFile(join(dir, "source.txt"), "original\n");
    await execute("git", ["add", "source.txt"], { cwd: dir });
    await execute(
      "git",
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.test",
        "commit",
        "--quiet",
        "-m",
        "fixture",
      ],
      { cwd: dir },
    );
    await writeFile(join(dir, "source.txt"), "user draft\n");
    await writeFile(join(dir, "user-notes.txt"), "keep user notes\n");
    const index = await readFile(join(dir, ".git/index"));
    snapshot = await snapshotToolWorkspace(dir);
    await writeFile(join(dir, "source.txt"), "user draft\nagent change\n");
    await writeFile(join(dir, "generated.txt"), "new output\n");
    const changes = await snapshot.changes();
    assert.equal(changes.length, 2);
    assert.ok(
      changes.some(
        (change) =>
          change.path.endsWith("generated.txt") && change.kind.type === "add",
      ),
    );
    const source = changes.find((change) => change.path.endsWith("source.txt"));
    assert.match(source.diff, / user draft\n\+agent change/);
    assert.doesNotMatch(source.diff, /-original/);
    assert.deepEqual(await readFile(join(dir, ".git/index")), index);
  } finally {
    await snapshot?.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("持久会话空闲释放保护活动轮次、后台任务、目标及近期输入", async () => {
  const dir = await mkdtemp(join(tmpdir(), "claude-idle-release-"));
  try {
    const storage = createStorage(join(dir, "state.json"), {
      sessions: {
        idle: {},
        active: {},
        background: { backgroundTasks: { task: { status: "running" } } },
        goal: { goal: { status: "active" } },
        recent: {},
      },
    });
    const runtime = createClaudeRuntime({
      backend: { dataDir: dir },
      storage,
      providers: {},
      broadcast() {},
      compactions: createCompactions(() => {}),
      questions: new Map(),
    });
    const closed = [];
    for (const id of ["idle", "active", "background", "goal", "recent"])
      runtime.queries.set(id, {
        lastActivityAt: id === "recent" ? 900000 : 0,
        close: () => closed.push(id),
      });
    runtime.running.set("active", {});
    await runtime.releaseUnusedThreads(1000000);
    assert.deepEqual(closed, ["idle"]);
    assert.deepEqual(
      [...runtime.queries.keys()],
      ["active", "background", "goal", "recent"],
    );
    runtime.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
