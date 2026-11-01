import React from "react";
import { diffRows } from "../domain/file-changes.js";
export function DiffBlock({ diff }) {
  const rows = diffRows(diff);
  const digits = rows.reduce(
    (width, row) =>
      Math.max(
        width,
        String(row.oldLine ?? "").length,
        String(row.newLine ?? "").length,
      ),
    3,
  );
  return (
    <div
      className="diff-block"
      style={{ "--diff-number-width": `${digits}ch` }}
    >
      {rows.map((row, i) => (
        <div key={i} className={row.className}>
          <span className="diff-number diff-old-number" title="原文件行号">
            {row.oldLine ?? ""}
          </span>
          <span className="diff-number diff-new-number" title="修改后文件行号">
            {row.newLine ?? ""}
          </span>
          <code>{row.text || " "}</code>
        </div>
      ))}
    </div>
  );
}
