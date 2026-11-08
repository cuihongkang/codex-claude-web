import { TextSelection } from "@milkdown/kit/prose/state";

export function syncDocumentSelection(view) {
  if (!view.hasFocus() || view.composing) return;
  const selection = view.dom.ownerDocument.getSelection();
  if (
    !selection ||
    !view.dom.contains(selection.anchorNode) ||
    !view.dom.contains(selection.focusNode)
  )
    return;
  const anchor = view.posAtDOM(selection.anchorNode, selection.anchorOffset);
  const head = view.posAtDOM(selection.focusNode, selection.focusOffset);
  const next = TextSelection.between(
    view.state.doc.resolve(anchor),
    view.state.doc.resolve(head),
  );
  if (!next.eq(view.state.selection))
    view.dispatch(view.state.tr.setSelection(next));
}

function sourceOffset(view, serialize, position) {
  const marker = "CODEXCURSOR" + crypto.randomUUID().replaceAll("-", "");
  const marked = view.state.tr.insertText(marker, position).doc;
  return serialize(marked).indexOf(marker);
}

export function documentCursor(view, serialize, end = false) {
  syncDocumentSelection(view);
  return sourceOffset(
    view,
    serialize,
    end ? view.state.selection.to : view.state.selection.from,
  );
}

export function documentPosition(view, serialize, position) {
  const points = [];
  view.state.doc.descendants((node, offset) => {
    if (node.isText) points.push({ from: offset, to: offset + node.nodeSize });
    else if (node.isInline && node.isAtom)
      points.push({ from: offset, to: offset + node.nodeSize });
    else if (node.isTextblock && !node.content.size)
      points.push({ from: offset + 1, to: offset + 1 });
  });
  let low = 0;
  let high = points.length - 1;
  let target = points[0];
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (sourceOffset(view, serialize, points[middle].from) <= position) {
      target = points[middle];
      low = middle + 1;
    } else high = middle - 1;
  }
  if (!target) return 1;
  let from = target.from;
  let to = target.to;
  while (from < to) {
    const middle = Math.ceil((from + to) / 2);
    if (sourceOffset(view, serialize, middle) <= position) from = middle;
    else to = middle - 1;
  }
  return from;
}

export function selectDocumentPosition(view, serialize, start, end = start) {
  view.dispatch(
    view.state.tr
      .setSelection(
        TextSelection.create(
          view.state.doc,
          documentPosition(view, serialize, start),
          documentPosition(view, serialize, end),
        ),
      )
      .scrollIntoView(),
  );
}
