import React from "react";
import { Sparkles, MessagesSquare, Folder } from "lucide-react";
import { pathIcon } from "./path-icon.jsx";

export function InlineReference({ reference, onOpen }) {
  const Icon =
    reference.kind === "skill"
      ? Sparkles
      : reference.kind === "thread"
        ? MessagesSquare
        : reference.kind === "directory"
          ? Folder
          : pathIcon(reference.path, { literal: true });
  return (
    <span
      className="inline-reference"
      data-reference-kind={reference.kind}
      title={reference.path}
    >
      <Icon size={14} aria-hidden="true" />
      {onOpen ? (
        <a
          href={reference.path}
          onClick={(event) => {
            event.preventDefault();
            onOpen();
          }}
        >
          {reference.displayName || reference.name}
        </a>
      ) : (
        <span>{reference.displayName || reference.name}</span>
      )}
    </span>
  );
}
