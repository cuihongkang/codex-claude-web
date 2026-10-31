import { ClaudeSessions } from "../../server/src/claude-sessions.mjs";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = await mkdtemp(join(tmpdir(), "claude-settings-"));
const manager = new ClaudeSessions({
  stateFile: join(root, "state.json"),
  defaultCwd: root,
});
try {
  const { session } = await manager.create({ cwd: root });
  await manager.configure({ id: session.id, model: "sonnet", effort: "high" });
  const settings = await manager.control(session.id, {
    subtype: "get_settings",
  });
  // Only output relevant fields, never credentials or other settings.
  console.log("settings structure", Object.keys(settings));
  for (const [key, value] of Object.entries(settings)) {
    if (value && typeof value === "object")
      console.log(
        key,
        JSON.stringify({
          model: value.model,
          effortLevel: value.effortLevel,
          effort: value.effort,
        }),
        "keys:",
        Object.keys(value),
      );
  }
  await manager.configure({ id: session.id, model: "", effort: "" });
  console.log(
    "reset applied",
    JSON.stringify(
      (await manager.control(session.id, { subtype: "get_settings" })).applied,
    ),
  );
  console.log("PASS model and effort controls including default reset");
  await manager.release(session.id);
} finally {
  manager.close();
}
