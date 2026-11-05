import React, { useState } from "react";

import {
  Folder,
  FolderOpen,
  FileCode,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { rpc, report } from "../../store.js";
export function TreeRow({ entry, path, depth = 0, onOpen }) {
  const [expanded, expand] = useState(false),
    [children, setChildren] = useState(null);
  const full = (path === "/" ? "" : path) + "/" + entry.fileName;
  async function click() {
    if (!entry.isDirectory) {
      onOpen(full);
      return;
    }
    if (!children) {
      try {
        const r = await rpc("fs/readDirectory", { path: full });
        setChildren(
          r.entries.sort(
            (a, b) =>
              Number(b.isDirectory) - Number(a.isDirectory) ||
              a.fileName.localeCompare(b.fileName),
          ),
        );
      } catch (e) {
        report(e);
        return;
      }
    }
    expand(!expanded);
  }
  return (
    <>
      <button
        className="tree-row"
        style={{ paddingLeft: 12 + depth * 15 }}
        onClick={click}
        title={full}
      >
        {entry.isDirectory ? (
          expanded ? (
            <ChevronDown size={12} />
          ) : (
            <ChevronRight size={12} />
          )
        ) : (
          <span className="tree-spacer" />
        )}
        {entry.isDirectory ? (
          expanded ? (
            <FolderOpen size={15} />
          ) : (
            <Folder size={15} />
          )
        ) : (
          <FileCode size={15} />
        )}
        <span>{entry.fileName}</span>
      </button>
      {expanded &&
        children?.map((child) => (
          <TreeRow
            key={child.fileName}
            entry={child}
            path={full}
            depth={depth + 1}
            onOpen={onOpen}
          />
        ))}
    </>
  );
}
