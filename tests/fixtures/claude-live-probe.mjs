// Explicit opt-in smoke probe; uses a new session and never resumes user history.
import { ClaudeSessions } from "../../server/src/claude-sessions.mjs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
const root = await mkdtemp(join(tmpdir(), "claude-live-"));
const events = [];
const manager = new ClaudeSessions({
  stateFile: join(root, "state.json"),
  defaultCwd: root,
  emit: (e) => events.push(e),
});
const wait = async (fn) => {
  for (let i = 0; i < 150; i++) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw Error("Timeout waiting for Claude");
};
try {
  const { session } = await manager.create({ cwd: root });
  await manager.send({
    id: session.id,
    text: "Integration test. Do not use tools. Reply exactly CLAUDE_WEB_FIRST_OK.",
    messageId: randomUUID(),
  });
  await wait(
    () =>
      manager.runtime.get(session.id)?.status === "idle" ||
      manager.runtime.get(session.id)?.status === "error",
  );
  let snapshot = await manager.open(session.id);
  if (snapshot.session.error) throw Error(snapshot.session.error);
  if (!JSON.stringify(snapshot.messages).includes("CLAUDE_WEB_FIRST_OK"))
    throw Error("Missing first reply");
  console.log("PASS streamed reply through manager");
  await manager.send({
    id: session.id,
    text: "What exact text did I previously ask you to reply with? Reply with that text only.",
    messageId: randomUUID(),
  });
  await wait(
    () =>
      manager.runtime.get(session.id)?.status === "idle" ||
      manager.runtime.get(session.id)?.status === "error",
  );
  snapshot = await manager.open(session.id);
  if (snapshot.session.error) throw Error(snapshot.session.error);
  if (
    !snapshot.messages
      .filter((m) => m.role === "assistant")
      .at(-1)
      ?.content.some((c) => c.text?.includes("CLAUDE_WEB_FIRST_OK"))
  )
    throw Error("Context lost");
  console.log("PASS same-process continuation");
  await manager.interrupt(session.id);
  console.log("PASS control response");
  await manager.release(session.id);
  console.log("PASS idle handoff");
  await writeFile(
    join(root, "result.json"),
    JSON.stringify({
      ok: true,
      sessionId: session.id,
      events: events.map((e) => e.method),
    }),
  );
  console.log("Evidence:", root);
} finally {
  manager.close();
}
