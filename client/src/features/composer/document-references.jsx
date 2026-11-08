import { syncDocumentSelection } from "./editor-selection.js";
import React from "react";
import { createRoot } from "react-dom/client";
import { Plugin } from "@milkdown/kit/prose/state";
import { $nodeSchema, $view, $prose } from "@milkdown/kit/utils";
import {
  inlineReference,
  referencePath,
  referenceTitle,
  referenceUrl,
} from "../../domain/inline-references.js";
import { set, useStore } from "../../store.js";
import { InlineReference } from "../../ui/inline-reference.jsx";

function fromMarkdown(node) {
  if (
    node.type !== "link" ||
    node.children.some((child) => child.type === "image")
  )
    return null;
  const path = referencePath(node.url);
  return inlineReference(
    path,
    node.children.map((child) => child.value || "").join(""),
    node.title,
  );
}

function referenceAttributes(reference) {
  const attributes = { "data-inline-reference": JSON.stringify(reference) };
  const prefix =
    reference.kind === "skill"
      ? "skill"
      : reference.kind === "thread"
        ? "agent"
        : "at";
  attributes[prefix + "-mention-path"] = reference.path;
  attributes[prefix + "-mention-" + (prefix === "at" ? "label" : "name")] =
    reference.name;
  if (prefix === "at") attributes["at-mention-fs-path"] = reference.path;
  else attributes[prefix + "-mention-display-name"] = reference.name;
  return attributes;
}

export const documentReferenceSchema = $nodeSchema("reference_inline", () => ({
  inline: true,
  group: "inline",
  atom: true,
  selectable: false,
  draggable: false,
  attrs: { reference: { default: null } },
  leafText: (node) => node.attrs.reference.name,
  parseDOM: [
    {
      tag: "span[at-mention-label][at-mention-path]",
      getAttrs: (dom) => {
        const path =
          dom.getAttribute("at-mention-fs-path") ||
          dom.getAttribute("at-mention-path");
        const directory = dom.getAttribute("at-mention-path").endsWith("/");
        const reference = inlineReference(
          path + (directory && !path.endsWith("/") ? "/" : ""),
          dom.getAttribute("at-mention-label"),
          "file-reference",
        );
        return reference ? { reference } : false;
      },
    },
    {
      tag: "span[skill-mention-name][skill-mention-path]",
      getAttrs: (dom) => {
        const reference = inlineReference(
          dom.getAttribute("skill-mention-path"),
          "$" + dom.getAttribute("skill-mention-name"),
        );
        return reference ? { reference } : false;
      },
    },
    {
      tag: "span[agent-mention-name][agent-mention-path]",
      getAttrs: (dom) => {
        const reference = inlineReference(
          dom.getAttribute("agent-mention-path"),
          dom.getAttribute("agent-mention-display-name") ||
            dom.getAttribute("agent-mention-name"),
        );
        return reference ? { reference } : false;
      },
    },
    {
      tag: "a[href]",
      getAttrs: (dom) => {
        const reference = inlineReference(
          referencePath(dom.getAttribute("href")),
          dom.textContent,
          dom.title,
        );
        return reference ? { reference } : false;
      },
    },
    {
      tag: "span[data-inline-reference]",
      getAttrs: (dom) => {
        try {
          const ref = JSON.parse(dom.dataset.inlineReference);
          const reference = inlineReference(
            ref.path,
            (ref.kind === "skill" ? "$" : "") + ref.name,
            referenceTitle(ref),
          );
          return reference ? { reference } : false;
        } catch {
          return false;
        }
      },
    },
  ],
  toDOM: (node) => [
    "span",
    referenceAttributes(node.attrs.reference),
    node.attrs.reference.name,
  ],
  parseMarkdown: {
    match: (node) => !!fromMarkdown(node),
    runner: (state, node, type) =>
      state.addNode(type, { reference: fromMarkdown(node) }),
  },
  toMarkdown: {
    match: (node) => node.type.name === "reference_inline",
    runner: (state, node) => {
      const ref = node.attrs.reference;
      state.openNode("link", undefined, {
        url: referenceUrl(ref.path),
        title: referenceTitle(ref),
      });
      state.addNode(
        "text",
        undefined,
        (ref.kind === "skill" ? "$" : "") + ref.name,
      );
      state.closeNode();
    },
  },
}));

function ComposerReference({ reference, onOpen }) {
  const { skills } = useStore();
  const metadata =
    reference.kind === "skill"
      ? skills.find(
          (skill) =>
            skill.path === reference.path ||
            (reference.native && skill.name === reference.name),
        )
      : null;
  return (
    <InlineReference
      reference={{
        ...reference,
        displayName: metadata?.interface?.displayName,
      }}
      onOpen={onOpen}
    />
  );
}

export const documentReferenceView = $view(
  documentReferenceSchema.node,
  () => (node, view) => {
    const dom = document.createElement("span");
    dom.contentEditable = "false";
    dom.className = "document-reference";
    const root = createRoot(dom);
    let current = node;
    function render() {
      dom.dataset.inlineReference = JSON.stringify(current.attrs.reference);
      const reference = current.attrs.reference;
      const onOpen = ["file", "directory"].includes(reference.kind)
        ? () => {
            view.focus();
            set({
              panel: "files",
              panelFile:
                reference.kind === "directory"
                  ? { path: reference.path, view: "directory" }
                  : reference.path,
            });
          }
        : undefined;
      root.render(<ComposerReference reference={reference} onOpen={onOpen} />);
    }
    render();
    return {
      dom,
      update(next) {
        if (next.type !== current.type) return false;
        current = next;
        render();
        return true;
      },
      ignoreMutation: () => true,
      destroy: () => root.unmount(),
    };
  },
);

export const documentReferenceKeys = $prose(
  () =>
    new Plugin({
      props: {
        handleDOMEvents: {
          keydown(view, event) {
            if (
              view.composing ||
              event.ctrlKey ||
              event.metaKey ||
              event.altKey ||
              !view.state.selection.empty ||
              !["Backspace", "Delete"].includes(event.key)
            )
              return false;
            syncDocumentSelection(view);
            const { $from } = view.state.selection;
            const before = event.key === "Backspace";
            const node = before ? $from.nodeBefore : $from.nodeAfter;
            if (node?.type.name !== "reference_inline") return false;
            const from = $from.pos - (before ? node.nodeSize : 0);
            event.preventDefault();
            view.dispatch(
              view.state.tr.delete(from, from + node.nodeSize).scrollIntoView(),
            );
            return true;
          },
        },
      },
    }),
);

export function referenceClipboardText(slice) {
  let hasReference = false;
  slice.content.descendants((node) => {
    if (node.type.name === "reference_inline") hasReference = true;
  });
  if (!hasReference) return undefined;
  return slice.content.textBetween(
    0,
    slice.content.size,
    "\n\n",
    (node) => node.type.spec.leafText?.(node) || node.attrs.alt || "",
  );
}
