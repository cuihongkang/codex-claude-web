import { readFile, readdir } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

async function identity(pid) {
  try {
    const [stat, bootId] = await Promise.all([
      readFile(`/proc/${pid}/stat`, "utf8"),
      readFile("/proc/sys/kernel/random/boot_id", "utf8"),
    ]);
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return {
      pid: Number(pid),
      parentPid: Number(fields[1]),
      state: fields[0],
      startTime: fields[19],
      bootId: bootId.trim(),
    };
  } catch (error) {
    if (["ENOENT", "ESRCH"].includes(error.code)) return null;
    throw error;
  }
}
export async function captureNativeProcesses(pid) {
  const owner = await identity(pid);
  if (!owner) return { owner: null, children: [] };
  const entries = (await readdir("/proc")).filter((name) => /^\d+$/.test(name));
  const processes = (await Promise.all(entries.map(identity))).filter(Boolean);
  const children = [];
  const parents = new Set([Number(pid)]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const process of processes)
      if (parents.has(process.parentPid) && !parents.has(process.pid)) {
        parents.add(process.pid);
        children.push(process);
        changed = true;
      }
  }
  return { owner, children };
}
async function alive(expected) {
  const actual = await identity(expected.pid);
  return (
    actual &&
    actual.startTime === expected.startTime &&
    actual.bootId === expected.bootId &&
    !["Z", "X"].includes(actual.state)
  );
}
export async function nativeProcessesAlive(session) {
  if (!session.nativeProcess) return null;
  const identities = [session.nativeProcess, ...(session.nativeChildren || [])];
  return (await Promise.all(identities.map(alive))).some(Boolean);
}
// 原始 SDK 标准输入输出连接已丢失时，显式清理只停止 PID、启动时间及 boot ID 均匹配的进程。
export async function recoverNativeProcesses(session) {
  const owner = session.nativeProcess;
  if (!owner) return false;
  const recorded = new Map(
    (session.nativeChildren || []).map((child) => [child.pid, child]),
  );
  if (await alive(owner)) {
    const current = await captureNativeProcesses(owner.pid);
    for (const child of current.children) recorded.set(child.pid, child);
  }
  recorded.set(owner.pid, owner);
  const all = [...recorded.values()];
  for (const entry of all)
    if (await alive(entry)) process.kill(entry.pid, "SIGTERM");
  for (let attempt = 0; attempt < 50; attempt++) {
    if (!(await Promise.all(all.map(alive))).some(Boolean)) return true;
    await delay(20);
  }
  for (const entry of all)
    if (await alive(entry)) process.kill(entry.pid, "SIGKILL");
  for (let attempt = 0; attempt < 50; attempt++) {
    if (!(await Promise.all(all.map(alive))).some(Boolean)) return true;
    await delay(20);
  }
  throw new Error("无法停止上次 Claude 会话遗留的进程，请检查进程权限后重试。");
}
