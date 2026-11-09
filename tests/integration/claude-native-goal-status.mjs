import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, appendFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createSessionReader } from "../../server/src/backends/claude/history.mjs";

const root = await mkdtemp(join(tmpdir(), "claude-native-goal-status-"));
try {
  const cwd = join(root, "workspace"),
    dataDir = join(root, "config");
  const project = join(dataDir, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
  await mkdir(cwd);
  await mkdir(project, { recursive: true });
  const id = randomUUID(),
    prompt = randomUUID();
  const path = join(project, `${id}.jsonl`);
  await writeFile(
    path,
    JSON.stringify({
      type: "user",
      uuid: prompt,
      parentUuid: null,
      sessionId: id,
      cwd,
      timestamp: new Date().toISOString(),
      message: { role: "user", content: "Goal native status proof" },
    }) + "\n",
  );
  const readSession = createSessionReader({ dataDir });
  const read = () => readSession("getNativeGoalStatus", id, { dir: cwd });
  assert.equal(await read(), null);
  let parentUuid = prompt;
  for (const attachment of [
    {
      type: "goal_status",
      met: false,
      sentinel: true,
      condition: "Run the checks",
    },
    {
      type: "goal_status",
      met: true,
      condition: "Run the checks",
      iterations: 2,
      durationMs: 100,
      tokens: 240,
    },
    {
      type: "goal_status",
      met: false,
      sentinel: true,
      condition: "Read inaccessible file",
    },
    {
      type: "goal_status",
      met: false,
      failed: true,
      condition: "Read inaccessible file",
      iterations: 1,
      durationMs: 20,
      tokens: 80,
    },
    {
      type: "goal_status",
      met: true,
      sentinel: true,
      condition: "Read inaccessible file",
    },
  ]) {
    const uuid = randomUUID();
    await appendFile(
      path,
      JSON.stringify({
        type: "attachment",
        uuid,
        parentUuid,
        sessionId: id,
        cwd,
        timestamp: new Date().toISOString(),
        attachment,
      }) + "\n",
    );
    parentUuid = uuid;
    const status = await read();
    assert.equal(status.nativeRecordId, uuid);
    assert.ok(status.nativeTimestamp);
    const { nativeRecordId, nativeTimestamp, ...nativeFields } = status;
    assert.deepEqual(
      nativeFields,
      attachment,
      "native state fields and sentinel are preserved verbatim",
    );
  }
  await appendFile(
    path,
    JSON.stringify({
      type: "custom-title",
      sessionId: id,
      customTitle: "Metadata after goal status",
    }) + "\n",
  );
  assert.equal((await read()).sentinel, true);
  assert.equal((await read()).met, true);
  console.log(
    "SDK imported native goal status preserves setting, completion, failure and clear sentinels",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
