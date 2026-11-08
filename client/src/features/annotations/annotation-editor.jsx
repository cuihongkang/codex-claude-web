import React, { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Trash2 } from "lucide-react";
import { set } from "../../store.js";
import { submitComposer } from "../commands/composer-commands.js";
import {
  readAnnotationDrafts,
  writeAnnotationDrafts,
} from "./annotation-drafts.js";
import { useSurfaceResize } from "../../ui/surface-resize.jsx";

export function AnnotationEditor({
  entry,
  editor,
  onRemove,
  annotationRoot,
  sourceRange,
  viewportScale,
}) {
  const {
    ref: panel,
    style: size,
    handle,
  } = useSurfaceResize({ id: "annotation", anchored: true });
  const area = useRef();
  const [expanded, setExpanded] = useState(false);
  const [point, setPoint] = useState(editor.point || { left: 16, top: 80 });
  useLayoutEffect(() => {
    const field = area.current;
    const view = field?.ownerDocument.defaultView;
    if (!view) return;
    if (size) {
      field.style.height = "";
      return;
    }
    const lineHeight = parseFloat(view.getComputedStyle(field).lineHeight);
    field.style.width = expanded ? "calc(100% - 4.4615rem)" : "";
    field.style.height = "0px";
    const multiline = field.scrollHeight > lineHeight + 1;
    field.style.width = "";
    field.style.height = Math.min(field.scrollHeight, lineHeight * 5) + "px";
    setExpanded(multiline);
  }, [entry.annotation, expanded, size]);
  useLayoutEffect(() => {
    const position = () => {
      const root = annotationRoot(entry.source?.messageId);
      const range = sourceRange(root, entry);
      const rect = range?.getBoundingClientRect();
      const boundary =
        document.querySelector(".composer-wrap")?.getBoundingClientRect().top ??
        window.innerHeight;
      const box = panel.current.getBoundingClientRect();
      const scale = viewportScale();
      const bottom = Math.min(window.innerHeight - 8, boundary - 8);
      const top =
        rect && rect.top >= 0 && rect.top < bottom
          ? rect.bottom + box.height + 12 <= bottom
            ? rect.bottom + 8
            : rect.top - box.height - 8
          : bottom - box.height;
      setPoint({
        left:
          Math.max(
            8,
            Math.min(
              rect?.left ?? editor.point?.left ?? 16,
              window.innerWidth - box.width - 8,
            ),
          ) / scale,
        top: Math.max(8, Math.min(top, bottom - box.height)) / scale,
      });
    };
    position();
    document.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    const observer = new ResizeObserver(position);
    observer.observe(panel.current);
    const root = annotationRoot(entry.source?.messageId);
    if (root) observer.observe(root);
    return () => {
      document.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
      observer.disconnect();
    };
  }, [entry.text, entry.source, editor.point]);
  const close = () => {
    set({ annotationEditor: null });
    document
      .querySelector(
        '[aria-label="消息"][role="textbox"], textarea[aria-label="消息"]',
      )
      ?.focus();
  };
  const update = (text) =>
    writeAnnotationDrafts(
      editor.threadId,
      readAnnotationDrafts(editor.threadId).map((current) =>
        current.id === entry.id ? { ...current, annotation: text } : current,
      ),
    );
  return createPortal(
    <form
      ref={panel}
      className="annotation-editor"
      style={{ ...point, ...size }}
      aria-label="编辑批注"
      aria-description={`引用原文：${entry.text}`}
      data-expanded={Boolean(size) || expanded}
      data-resized={Boolean(size)}
      onSubmit={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
        }
        if (
          event.key === "Enter" &&
          !event.altKey &&
          !event.metaKey &&
          !event.shiftKey &&
          !event.nativeEvent.isComposing &&
          event.nativeEvent.keyCode !== 229
        ) {
          event.preventDefault();
          if (event.ctrlKey) submitComposer();
          else close();
        }
      }}
    >
      <textarea
        ref={area}
        aria-label="批注内容"
        placeholder="添加批注…"
        autoFocus
        rows={1}
        value={entry.annotation || ""}
        onChange={(event) => update(event.target.value)}
      />
      <div className="annotation-editor-actions">
        <button
          type="button"
          className="annotation-editor-remove"
          aria-label="移除批注"
          title="移除批注"
          onClick={onRemove}
        >
          <Trash2 size={15} />
        </button>
        <button
          type="submit"
          className="annotation-editor-done"
          aria-label="完成批注"
          title="完成批注"
        >
          <Check size={16} strokeWidth={2.2} />
        </button>
      </div>
      {handle}
    </form>,
    document.body,
  );
}
