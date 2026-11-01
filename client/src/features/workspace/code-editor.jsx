import React, { useEffect, useRef } from "react";
import { Compartment, EditorState, Transaction } from "@codemirror/state";
import {
  EditorView,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
  keymap,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting } from "@codemirror/language";
import { fileLanguage, codeHighlightStyle } from "./editor-language.js";
import { fileChangeMarks } from "./file-change-marks.js";
import { fileChangeHighlights } from "../../domain/file-changes.js";

export function CodeEditor({ path, text, onChange, diff = "", patches }) {
  const parent = useRef(),
    handler = useRef(onChange),
    view = useRef(),
    marks = useRef(new Compartment());
  handler.current = onChange;
  useEffect(() => {
    const editor = new EditorView({
      parent: parent.current,
      state: EditorState.create({
        doc: text,
        extensions: [
          lineNumbers(),
          marks.current.of([]),
          history(),
          drawSelection(),
          highlightActiveLine(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          syntaxHighlighting(codeHighlightStyle),
          fileLanguage(path),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) handler.current(update.state.doc.toString());
          }),
          EditorView.theme({
            "&": {
              height: "100%",
              fontSize: "var(--code-font-size)",
              backgroundColor: "var(--bg)",
              color: "var(--fg)",
            },
            ".cm-scroller": {
              overflow: "auto",
              fontFamily: "var(--mono)",
              lineHeight: "var(--code-line-height)",
            },
            ".cm-gutters": {
              backgroundColor: "var(--subtle)",
              color: "var(--muted)",
              border: "none",
            },
            ".cm-activeLine": { backgroundColor: "var(--hover)" },
            ".cm-activeLineGutter": { backgroundColor: "var(--hover)" },
            ".cm-content": { padding: "0.923077rem 0" },
            ".cm-cursor": { borderLeftColor: "var(--fg)" },
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
  }, [path]);
  useEffect(() => {
    const editor = view.current;
    if (editor.state.doc.toString() !== text)
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: text },
        effects: marks.current.reconfigure(
          diff ? fileChangeMarks(diff, patches) : [],
        ),
        annotations: Transaction.addToHistory.of(false),
      });
  }, [text]);
  useEffect(() => {
    const editor = view.current;
    editor.dispatch({
      effects: marks.current.reconfigure(
        diff ? fileChangeMarks(diff, patches) : [],
      ),
    });
    const first = fileChangeHighlights(
      editor.state.doc.toString(),
      diff,
      patches,
    ).firstLine;
    if (first !== null)
      editor.dispatch({
        effects: EditorView.scrollIntoView(
          editor.state.doc.line(Math.min(first, editor.state.doc.lines)).from,
          { y: "center" },
        ),
      });
  }, [path, diff, patches]);
  return <div className="code-editor" ref={parent} />;
}
