import React from "react";
import { set, useStore } from "../../store.js";
import { localImagePath } from "../../domain/image-source.js";
import { pathIcon } from "../../ui/path-icon.jsx";
import {
  inlineReference,
  referencePath,
} from "../../domain/inline-references.js";
import { InlineReference } from "../../ui/inline-reference.jsx";
import { openThread } from "../../store.js";

function labelText(node) {
  return node.type === "text"
    ? node.value
    : (node.children || []).map(labelText).join("");
}

export function MessageLink({
  href,
  title,
  children,
  node,
  cwd: baseDirectory,
}) {
  const { current, cwd, defaultCwd, skills } = useStore();
  const imageOnly = node?.children?.every(
    (child) =>
      child.tagName === "img" || (child.type === "text" && !child.value.trim()),
  );
  const reference = inlineReference(
    referencePath(href),
    node ? labelText(node) : String(children),
    title,
  );
  if (reference?.kind === "skill")
    reference.displayName = skills.find(
      (skill) =>
        skill.path === reference.path ||
        (reference.native && skill.name === reference.name),
    )?.interface?.displayName;
  if (reference && !imageOnly)
    return (
      <InlineReference
        reference={reference}
        onOpen={() =>
          reference.kind === "thread"
            ? openThread(reference.threadId)
            : reference.path.startsWith("skill://")
              ? set({ modal: { type: "skills" } })
              : set({
                  panel: "files",
                  panelFile:
                    reference.kind === "directory"
                      ? { path: reference.path, view: "directory" }
                      : reference.path,
                })
        }
      />
    );
  const Icon = pathIcon(
    (href || "").replace(/^file:\/\/(?:localhost)?(?=\/)|^sandbox:(?=\/)/i, ""),
  );
  if (href && !href.startsWith("#"))
    href =
      localImagePath(
        href,
        baseDirectory ?? (current?.cwd || cwd || defaultCwd),
      ) || href;
  return (
    <a
      className="message-link"
      href={href}
      title={title || href}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => {
        if (href?.startsWith("#")) {
          event.preventDefault();
          const root = event.currentTarget.closest(".markdown");
          let id;
          try {
            id = decodeURIComponent(href.slice(1));
          } catch {
            id = href.slice(1);
          }
          const target = id
            ? [...(root?.querySelectorAll("[id]") || [])].find(
                (element) =>
                  element.id === id || element.id === "user-content-" + id,
              )
            : root;
          if (target) {
            let parent = target.parentElement;
            while (parent && parent !== root) {
              if (parent.tagName === "DETAILS") parent.open = true;
              parent = parent.parentElement;
            }
            target.scrollIntoView({ block: "start" });
          }
        } else if (href?.startsWith("/") && !href.startsWith("//")) {
          event.preventDefault();
          set({
            panel: "files",
            panelFile: href.replace(/:\d+(?::\d+)?$/, ""),
          });
        }
      }}
    >
      {href && !imageOnly && (
        <Icon
          className="message-link-icon"
          aria-hidden="true"
          focusable="false"
        />
      )}
      {children}
    </a>
  );
}
