import { applyPatch, diffLines, parsePatch, reversePatch } from "diff";

function unquotePath(value) {
  if (!value.startsWith('"')) return value.split("\t")[0];
  const bytes = [];
  const text = value.slice(1, value.lastIndexOf('"'));
  for (let i = 0; i < text.length; i++) {
    const octal = text.slice(i).match(/^\\([0-7]{3})/);
    if (octal) {
      bytes.push(parseInt(octal[1], 8));
      i += 3;
    } else if (text[i] === "\\") {
      const escaped = text[++i];
      bytes.push(
        ...new TextEncoder().encode(
          { t: "\t", n: "\n", r: "\r" }[escaped] || escaped,
        ),
      );
    } else {
      const character = String.fromCodePoint(text.codePointAt(i));
      bytes.push(...new TextEncoder().encode(character));
      i += character.length - 1;
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

export function changePath(path, cwd) {
  if (!path) return "";
  const absolute = path.startsWith("/") ? path : `${cwd}/${path}`;
  const parts = [];
  for (const part of absolute.split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return "/" + parts.join("/");
}

// 区块坐标只用于恢复两侧文件行号，补丁元数据保持无行号展示。
export function diffRows(diff) {
  const rows = [];
  let oldLine = 0,
    newLine = 0,
    oldRemaining = 0,
    newRemaining = 0;
  const lines = (diff || "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const text = lines[index];
    const hunk = text.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunk) {
      oldLine = Number(hunk[1]);
      oldRemaining = Number(hunk[2] ?? 1);
      newLine = Number(hunk[3]);
      newRemaining = Number(hunk[4] ?? 1);
      continue;
    }
    if (!text && index === lines.length - 1) continue;
    const row = { text, oldLine: null, newLine: null, className: "" };
    if (text.startsWith("diff ")) {
      oldRemaining = newRemaining = 0;
      row.className = "diff-file";
    } else if (oldRemaining > 0 && text.startsWith("-")) {
      row.oldLine = oldLine++;
      oldRemaining--;
      row.className = "diff-remove";
    } else if (newRemaining > 0 && text.startsWith("+")) {
      row.newLine = newLine++;
      newRemaining--;
      row.className = "diff-add";
    } else if (oldRemaining > 0 && newRemaining > 0 && text.startsWith(" ")) {
      row.oldLine = oldLine++;
      row.newLine = newLine++;
      oldRemaining--;
      newRemaining--;
    } else if (/^(--- |\+\+\+ )/.test(text)) row.className = "diff-meta";
    rows.push(row);
  }
  return rows;
}

// 逆序还原逐次补丁，再计算净变更，避免将中间版本直接与最终正文比较。
export function fileChangeHighlights(text, diff, patches = [diff]) {
  let before = text;
  try {
    for (const record of patches.slice().reverse()) {
      for (const patch of reversePatch(parsePatch(record || ""))) {
        if (before && patch.oldFileName === "/dev/null")
          return { added: [], removed: [], matches: false, firstLine: null };
        before = applyPatch(before, patch);
        if (before === false)
          return { added: [], removed: [], matches: false, firstLine: null };
      }
    }
  } catch {
    return { added: [], removed: [], matches: false, firstLine: null };
  }
  const added = [],
    removed = [];
  let oldLine = 1,
    newLine = 1;
  for (const part of diffLines(before, text, {
    stripTrailingCr: true,
    ignoreNewlineAtEof: true,
  })) {
    if (part.added)
      for (let index = 0; index < part.count; index++)
        added.push(newLine + index);
    if (part.removed)
      removed.push({
        line: newLine,
        oldLine,
        lines: part.value.replace(/\n$/, "").split("\n"),
      });
    if (!part.added) oldLine += part.count;
    if (!part.removed) newLine += part.count;
  }
  const firstLine = [...added, ...removed.map((group) => group.line)].reduce(
    (first, line) => Math.min(first, line),
    Infinity,
  );
  return {
    added,
    removed,
    matches: true,
    firstLine: Number.isFinite(firstLine) ? firstLine : null,
  };
}

export function diffStats(diff, kind = "update") {
  if (kind !== "update" && !/^--- .+\n\+\+\+ .+\n/m.test(diff || "")) {
    const count = diff
      ? diff.split("\n").length - Number(diff.endsWith("\n"))
      : 0;
    return {
      added: kind === "add" ? count : 0,
      removed: kind === "delete" ? count : 0,
    };
  }
  let added = 0,
    removed = 0,
    hunk = false;
  for (const line of (diff || "").split("\n")) {
    if (line.startsWith("@@ ")) hunk = true;
    else if (line.startsWith("diff --git ")) hunk = false;
    else if (hunk && line.startsWith("+")) added++;
    else if (hunk && line.startsWith("-")) removed++;
  }
  if (!hunk && !added && !removed && diff && kind !== "update") {
    const count = diff.split("\n").length - Number(diff.endsWith("\n"));
    if (kind === "add") added = count;
    if (kind === "delete") removed = count;
  }
  return { added, removed };
}

function changeDiff(change) {
  const kind = change.kind?.type;
  if (kind === "update" || /^--- .+\n\+\+\+ .+\n/m.test(change.diff))
    return change.diff;
  const content = change.diff;
  const lines = content ? content.split("\n") : [];
  if (content.endsWith("\n")) lines.pop();
  const added = kind === "add";
  const before = added ? "/dev/null" : change.path;
  const after = added ? change.path : "/dev/null";
  const body = lines.map((line) => (added ? "+" : "-") + line).join("\n");
  return `--- ${before}\n+++ ${after}\n@@ -${added ? "0,0" : `1,${lines.length}`} +${added ? `1,${lines.length}` : "0,0"} @@\n${body}${content && !content.endsWith("\n") ? "\n\\ No newline at end of file" : ""}\n`;
}

export function unifiedFiles(diff, cwd) {
  if (!diff?.trim()) return [];
  return diff
    .split(/(?=^diff --git )/m)
    .filter(Boolean)
    .flatMap((text) => {
      const before = text.match(/^--- (.+)$/m);
      const after = text.match(/^\+\+\+ (.+)$/m);
      const renamedFrom = text.match(/^rename from (.+)$/m);
      const renamedTo = text.match(/^rename to (.+)$/m);
      if ((!before || !after) && (!renamedFrom || !renamedTo)) return [];
      const read = (value) => {
        const path = unquotePath(value);
        return path === "/dev/null"
          ? null
          : changePath(path.replace(/^[ab]\//, ""), cwd);
      };
      const oldPath = renamedFrom
          ? changePath(unquotePath(renamedFrom[1]), cwd)
          : read(before[1]),
        path = renamedTo
          ? changePath(unquotePath(renamedTo[1]), cwd)
          : read(after[1]);
      return [
        {
          path: path || oldPath,
          oldPath,
          kind: !oldPath ? "add" : !path ? "delete" : "update",
          diff: text,
          patches: [text],
          ...diffStats(text),
        },
      ];
    });
}

// 历史使用已完成的文件记录；实时轮次差异提供从轮次开始到结束的净行数。
export function turnFileChanges(items, diff, cwd) {
  const files = new Map();
  for (const item of items) {
    if (item.type !== "fileChange" || item.status !== "completed") continue;
    for (const change of item.changes || []) {
      const oldPath = changePath(change.path, cwd);
      const path = changePath(change.kind?.move_path || change.path, cwd);
      let file = files.get(oldPath);
      if (!file)
        file = {
          path,
          oldPath,
          kind: change.kind?.type || "update",
          changes: [],
          added: 0,
          removed: 0,
        };
      if (path !== oldPath) files.delete(oldPath);
      file.path = path;
      if (change.kind?.type === "delete") file.kind = "delete";
      else if (file.kind === "delete") file.kind = "update";
      file.changes.push(change);
      const stats = diffStats(change.diff, change.kind?.type);
      file.added += stats.added;
      file.removed += stats.removed;
      files.set(path, file);
    }
  }
  for (const file of files.values()) {
    file.patches = file.changes.map(changeDiff);
    file.diff = file.patches.join("\n");
  }
  if (diff !== undefined) {
    const net = unifiedFiles(diff, cwd);
    if (diff.trim() && !net.length) return [...files.values()];
    return net.map((file) => ({
      ...files.get(file.path),
      ...file,
      changes: files.get(file.path)?.changes || [],
    }));
  }
  return [...files.values()];
}
