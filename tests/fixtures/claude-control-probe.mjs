import { ClaudeSessions } from "../../server/src/claude-sessions.mjs";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
const root = await mkdtemp(join(tmpdir(), "claude-control-"));
const manager = new ClaudeSessions({
  stateFile: join(root, "state.json"),
  defaultCwd: root,
});
const wait = async (fn) => {
  for (let n = 0; n < 120; n++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw Error("Timed out");
};
try {
  const { session } = await manager.create({ cwd: root });
  await manager.send({
    id: session.id,
    messageId: randomUUID(),
    text: `Integration test. Use only the Bash tool to execute exactly: printf TOOL_APPROVED_OK > '${root}/probe.txt' . Do not use any other tool. After it succeeds reply TOOL_DONE.`,
  });
  let approvals = 0;
  await wait(async () => {
    const r = manager.runtime.get(session.id);
    for (const p of r.permissions.values()) {
      const allow =
        p.tool === "Bash" &&
        p.input.command.includes(root + "/probe.txt") &&
        !/[;\n]/.test(p.input.command);
      await manager.answer({ id: session.id, requestId: p.id, allow });
      approvals++;
    }
    if (r.status === "error") throw Error(r.error);
    return r.status === "idle";
  });
  if ((await readFile(join(root, "probe.txt"), "utf8")) !== "TOOL_APPROVED_OK")
    throw Error("Tool execution failed");
  console.log("PASS real tool execution; permission prompts:", approvals);
  await manager.send({
    id: session.id,
    messageId: randomUUID(),
    text: "Do not use tools. Write a very long numbered list from 1 to 5000, one short sentence on each line. This tests cancellation.",
  });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  if (manager.runtime.get(session.id).status !== "running")
    throw Error("Test turn completed before cancellation");
  await manager.interrupt(session.id);
  await wait(() =>
    ["idle", "error"].includes(manager.runtime.get(session.id).status),
  );
  console.log("PASS interrupt during streaming generation");
  await manager.release(session.id);
  console.log("Evidence directory:", root);
} finally {
  manager.close();
}
