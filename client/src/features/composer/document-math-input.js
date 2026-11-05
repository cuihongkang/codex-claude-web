import { TextSelection } from "@milkdown/kit/prose/state";
import { closeHistory } from "@milkdown/kit/prose/history";

function paragraphSource($position) {
  return $position.parent.textBetween(
    0,
    $position.parent.content.size,
    "\n",
    "\uFFFC",
  );
}

function openFormula(source, offset) {
  const markers = [
    ...source.slice(0, offset).matchAll(/(?<![\\$])\$\$(?!\$)/g),
  ];
  const start = markers.length % 2 ? markers.at(-1).index : -1;
  return start >= 0 && !insideCode(source, start) ? start : -1;
}

function insideCode(source, offset) {
  let delimiter = "";
  for (const match of source.slice(0, offset).matchAll(/(?<!\\)`+/g)) {
    if (!delimiter) delimiter = match[0];
    else if (delimiter === match[0]) delimiter = "";
  }
  return Boolean(delimiter);
}

function insertMath(view, from, to, text) {
  const { state } = view;
  const $from = state.doc.resolve(from);
  const $to = state.doc.resolve(to);
  if (
    !$from.sameParent($to) ||
    !$from.parent.isTextblock ||
    $from.parent.type.spec.code ||
    (state.storedMarks ?? $from.marks()).some((mark) => mark.type.spec.code)
  )
    return false;
  const source = paragraphSource($from);
  // 整段插入交给 Markdown 解析，保留外围结构。
  if (!source && text.length > 1) return false;
  const candidate =
    source.slice(0, $from.parentOffset) + text + source.slice($to.parentOffset);
  const offset = $from.parentOffset + text.length;
  const matches = [
    ...candidate
      .slice(0, offset)
      .matchAll(/(?<![\\$])\$\$((?:\\[\s\S]|(?!\$\$)[^\\])+?)\$\$(?!\$)/g),
  ].filter(
    (match) =>
      match[1].trim() &&
      !insideCode(candidate, match.index) &&
      (match.index + match[0].length > $from.parentOffset ||
        (!text && match.index + match[0].length === offset)),
  );
  if (!matches.length) {
    if (openFormula(source, $from.parentOffset) < 0) return false;
    view.dispatch(state.tr.insertText(text, from, to).scrollIntoView());
    return true;
  }
  const tr = closeHistory(state.tr).insertText(text, from, to);
  let removed = 0;
  for (const match of matches.reverse()) {
    const value = match[1].trim().replace(/\s*\n\s*/g, " ");
    const start = $from.start() + match.index;
    const math = state.schema.nodes.math_inline.create({ value });
    tr.replaceWith(start, start + match[0].length, math);
    removed += match[0].length - math.nodeSize;
  }
  tr.setSelection(
    TextSelection.create(tr.doc, $from.start() + offset - removed),
  );
  view.dispatch(tr.scrollIntoView());
  return true;
}

export function documentMathInput() {
  return {
    handleDOMEvents: {
      compositionend(view) {
        requestAnimationFrame(() => {
          if (view.isDestroyed || !view.dom.isConnected) return;
          insertMath(
            view,
            view.state.selection.from,
            view.state.selection.to,
            "",
          );
        });
        return false;
      },
    },
    handleTextInput(view, from, to, text) {
      if (view.composing) return false;
      return insertMath(view, from, to, text);
    },
    handleKeyDown(view, event) {
      const { $from, $to, from, to } = view.state.selection;
      if (
        event.key !== "Enter" ||
        event.ctrlKey ||
        event.metaKey ||
        view.composing ||
        !$from.sameParent($to) ||
        !$from.parent.isTextblock ||
        $from.parent.type.spec.code ||
        openFormula(paragraphSource($from), $from.parentOffset) < 0
      )
        return false;
      event.preventDefault();
      return insertMath(view, from, to, "\n");
    },
    handlePaste(view, event) {
      const text = event.clipboardData?.getData("text/plain");
      if (!text) return false;
      return insertMath(
        view,
        view.state.selection.from,
        view.state.selection.to,
        text,
      );
    },
  };
}
