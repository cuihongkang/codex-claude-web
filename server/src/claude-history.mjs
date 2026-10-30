import { readdir, readFile, stat, open } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";

export const sessionIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseRecord(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
export function transcriptMessage(record) {
  if (!["user", "assistant"].includes(record?.type) || !record.message)
    return null;
  const content =
    typeof record.message.content === "string"
      ? [{ type: "text", text: record.message.content }]
      : record.message.content;
  if (!Array.isArray(content)) return null;
  return {
    id: record.uuid || record.message.id,
    role: record.type,
    content,
    timestamp: record.timestamp,
    parentToolUseId: record.parent_tool_use_id || null,
  };
}
export async function readTranscript(path) {
  const messages = new Map();
  for await (const line of createInterface({
    input: createReadStream(path),
    crlfDelay: Infinity,
  })) {
    const message = transcriptMessage(parseRecord(line));
    if (message?.id) messages.set(message.id, message);
  }
  return [...messages.values()];
}
async function directories(path) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
export async function scanSessions(home) {
  const sessions = [];
  for (const directory of await directories(join(home, "projects"))) {
    if (!directory.isDirectory()) continue;
    const root = join(home, "projects", directory.name);
    for (const file of await directories(root)) {
      if (!file.isFile() || !file.name.endsWith(".jsonl")) continue;
      const id = file.name.slice(0, -6);
      if (!sessionIdPattern.test(id)) continue;
      const path = join(root, file.name);
      let handle;
      try {
        const info = await stat(path);
        handle = await open(path, "r");
        const head = Buffer.alloc(Math.min(info.size, 65536));
        await handle.read(head, 0, head.length, 0);
        const tail = Buffer.alloc(Math.min(info.size, 16384));
        await handle.read(
          tail,
          0,
          tail.length,
          Math.max(0, info.size - tail.length),
        );
        const records = head
          .toString()
          .split("\n")
          .map(parseRecord)
          .filter(Boolean);
        const ending = tail
          .toString()
          .split("\n")
          .map(parseRecord)
          .filter(Boolean);
        const cwd = records.find((r) => typeof r.cwd === "string")?.cwd;
        if (!cwd) continue;
        const user = records.find(
          (r) =>
            r.type === "user" &&
            !r.isMeta &&
            transcriptMessage(r)?.content.some((c) => c.type === "text"),
        );
        const preview =
          transcriptMessage(user)
            ?.content.filter((c) => c.type === "text")
            .map((c) => c.text)
            .join(" ") || "Claude 会话";
        const title = [...records, ...ending]
          .filter((r) => r.type === "custom-title")
          .at(-1)?.customTitle;
        sessions.push({
          id,
          cwd,
          title: title || preview.slice(0, 100),
          updatedAt: info.mtimeMs,
          path,
        });
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      } finally {
        await handle?.close();
      }
    }
  }
  return sessions;
}
export async function externalOwner(home, id, ownPid) {
  for (const file of await directories(join(home, "sessions"))) {
    if (!file.isFile() || !file.name.endsWith(".json")) continue;
    let record;
    try {
      record = JSON.parse(
        await readFile(join(home, "sessions", file.name), "utf8"),
      );
    } catch (error) {
      if (error.code === "ENOENT" || error instanceof SyntaxError) continue;
      throw error;
    }
    if (
      record.sessionId !== id ||
      record.pid === ownPid ||
      !Number.isInteger(record.pid) ||
      record.pid < 1
    )
      continue;
    try {
      process.kill(record.pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") continue;
      if (error.code !== "EPERM") throw error;
    }
    if (record.procStart && process.platform === "linux") {
      try {
        const value = await readFile(`/proc/${record.pid}/stat`, "utf8");
        if (
          value.slice(value.lastIndexOf(")") + 2).split(" ")[19] !==
          String(record.procStart)
        )
          continue;
      } catch (error) {
        if (error.code === "ENOENT") continue;
      }
    }
    return {
      pid: record.pid,
      source: record.entrypoint || "Claude CLI",
      status: record.status || "unknown",
    };
  }
  return null;
}
