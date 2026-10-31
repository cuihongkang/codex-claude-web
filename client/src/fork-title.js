const numberedSuffix = /^(.*) \((\d+)\)$/u;

function parseNumber(title) {
  const match = title.match(numberedSuffix);
  const number = Number(match?.[2]);
  return match && number >= 2 ? { base: match[1], number } : null;
}

function formatTitle(base, number) {
  const suffix = ` (${number})`;
  const available = 60 - suffix.length;
  return (
    (base.length > available
      ? base.slice(0, available - 1).trimEnd() + "…"
      : base) + suffix
  );
}

function titleNumber(title, base) {
  if (title === base) return 1;
  const parsed = parseNumber(title);
  return parsed && formatTitle(base, parsed.number) === title
    ? parsed.number
    : null;
}

function belongsTo(id, root, threads) {
  const visited = new Set();
  while (id && !visited.has(id)) {
    if (id === root) return true;
    visited.add(id);
    id = threads.get(id)?.forkedFromId;
  }
  return false;
}

function familyOf(thread, threads) {
  const parsed = parseNumber(thread.name);
  if (!parsed || !thread.forkedFromId)
    return { base: thread.name, root: thread.id };
  let parent = threads.get(thread.forkedFromId);
  if (!parent) return { base: parsed.base, root: thread.id };
  const visited = new Set([thread.id]);
  while (parent && !visited.has(parent.id)) {
    visited.add(parent.id);
    for (const base of [parent.name, parseNumber(parent.name)?.base]) {
      if (!base || formatTitle(base, parsed.number) !== thread.name) continue;
      let root = parent.id;
      let ancestor = threads.get(parent.forkedFromId);
      while (
        ancestor &&
        !visited.has(ancestor.id) &&
        titleNumber(ancestor.name, base) !== null
      ) {
        visited.add(ancestor.id);
        root = ancestor.id;
        ancestor = threads.get(ancestor.forkedFromId);
      }
      return { base, root };
    }
    parent = threads.get(parent.forkedFromId);
  }
  return { base: thread.name, root: thread.id };
}

// 仅沿真实父子关系识别旧网页自动添加的后缀，保留手动命名的含义。
function legacySource(thread, threads) {
  const visited = new Set();
  while (thread && !visited.has(thread.id)) {
    visited.add(thread.id);
    const parent = threads.get(thread.forkedFromId);
    if (!parent || thread.name !== parent.name.slice(0, 70) + " (分支)") break;
    thread = parent;
  }
  return thread;
}

export function nextForkTitle(source, records) {
  const threads = new Map(
    [...records, source].map((thread) => [
      thread.id,
      { ...thread, name: thread.name?.trim() || thread.preview || "新对话" },
    ]),
  );
  const original = threads.get(source.id);
  const family = familyOf(legacySource(original, threads), threads);
  let number = 1;
  for (const thread of threads.values()) {
    if (!belongsTo(thread.id, family.root, threads)) continue;
    const title = legacySource(thread, threads).name;
    number = Math.max(number, titleNumber(title, family.base) ?? 0);
  }
  return formatTitle(family.base, number + 1);
}
