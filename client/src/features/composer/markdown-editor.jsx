import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

export function MarkdownEditor({
  value,
  inputRef,
  theme,
  expanded,
  activeId,
  ...inputProps
}) {
  const label = inputProps["aria-label"] || "消息";
  const props = {
    ...inputProps,
    "aria-label": label,
    "aria-autocomplete": "list",
    "aria-expanded": expanded,
    "aria-activedescendant": activeId,
  };
  const mount = useRef();
  const fallback = useRef();
  const exposed = useRef();
  const editor = useRef();
  const latest = useRef();
  const rendered = useRef(value);
  const pendingSelection = useRef();
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  latest.current = { value, props };
  useEffect(() => {
    let disposed = false;
    let instance;
    import("./document-editor.js")
      .then(async ({ createDocumentEditor }) => {
        if (disposed) return;
        const initialValue = latest.current.value;
        const startedFocused = document.activeElement === fallback.current;
        instance = await createDocumentEditor(mount.current, {
          value: initialValue,
          placeholder: latest.current.props.placeholder,
          onChange(text) {
            if (disposed || !editor.current) return;
            rendered.current = text;
            latest.current.props.onChange({ target: inputRef.current });
          },
        });
        if (disposed) {
          await instance.destroy();
          return;
        }
        const previous = fallback.current;
        const focused =
          document.activeElement === previous ||
          (startedFocused && document.activeElement === document.body);
        const cursor = previous?.selectionStart || 0;
        const end = previous?.selectionEnd ?? cursor;
        editor.current = instance;
        if (latest.current.value !== initialValue)
          instance.setText(latest.current.value);
        rendered.current = latest.current.value;
        exposed.current = {
          focus: () => instance.focus(),
          replaceText: (text, start, end) =>
            instance.replaceText(text, start, end),
          insertReference: (reference, start, end) =>
            instance.insertReference(reference, start, end),
          setSelectionRange: (start, end) => instance.setCursor(start, end),
          get value() {
            return rendered.current;
          },
          get selectionStart() {
            return instance.getCursor();
          },
          get selectionEnd() {
            return instance.getCursor(true);
          },
        };
        inputRef.current = exposed.current;
        if (focused) pendingSelection.current = { cursor, end };
        setReady(true);
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      editor.current?.destroy();
      editor.current = null;
      if (inputRef.current === exposed.current) inputRef.current = null;
    };
  }, []);
  useLayoutEffect(() => {
    if (!ready || !pendingSelection.current) return;
    const { cursor, end } = pendingSelection.current;
    pendingSelection.current = null;
    editor.current.focus();
    editor.current.setCursor(cursor, end);
  }, [ready]);
  useEffect(() => {
    if (editor.current && value !== rendered.current) {
      editor.current.setText(value);
      rendered.current = value;
    }
  }, [value, ready]);
  useEffect(() => {
    if (!editor.current) return;
    editor.current.setAttributes({
      role: "textbox",
      "aria-label": label,
      "aria-multiline": "true",
      "aria-autocomplete": "list",
      "aria-expanded": String(expanded),
      ...(activeId ? { "aria-activedescendant": activeId } : {}),
      "data-placeholder": props.placeholder,
    });
  }, [ready, expanded, activeId, props.placeholder, label]);
  const eventTarget = (event) => ({ ...event, target: inputRef.current });
  return (
    <div className="markdown-composer">
      {!ready && (
        <textarea
          {...props}
          ref={(node) => {
            fallback.current = node;
            if (node) {
              exposed.current = node;
              inputRef.current = node;
            }
          }}
          value={value}
          rows={2}
        />
      )}
      {failed && (
        <span role="status">编辑器加载失败，可继续输入 Markdown。</span>
      )}
      <div
        ref={mount}
        className="document-editor-viewport"
        hidden={!ready}
        onKeyDownCapture={(event) => {
          if (!ready || event.target.closest("input, textarea, button")) return;
          props.onKeyDown?.(event);
          if (event.defaultPrevented) event.stopPropagation();
        }}
        onPasteCapture={(event) => {
          props.onPaste?.(event);
          if (event.defaultPrevented) event.stopPropagation();
        }}
        onClick={(event) => {
          if (ready) props.onClick?.(eventTarget(event));
        }}
        onKeyUp={(event) => {
          if (ready) props.onKeyUp?.(eventTarget(event));
        }}
      />
    </div>
  );
}
