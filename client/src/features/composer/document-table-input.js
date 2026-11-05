import { parserCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";

export function enterMarkdownTable(ctx, view) {
  const { state } = view;
  const { $from } = state.selection;
  const index = $from.index(-1);
  if (!index || !/^\s*\|?\s*:?-{3,}/.test($from.parent.textContent))
    return false;
  const previous = $from.node(-1).child(index - 1);
  if (previous.type.name !== "paragraph" || !previous.textContent.includes("|"))
    return false;
  const parsed = ctx.get(parserCtx)(
    previous.textContent + "\n" + $from.parent.textContent,
  );
  const parsedTable = parsed?.firstChild;
  if (parsedTable?.type.name !== "table") return false;
  const header = parsedTable.firstChild;
  const cells = [];
  header.forEach((cell) =>
    cells.push(
      state.schema.nodes.table_cell.createAndFill({
        alignment: cell.attrs.alignment,
      }),
    ),
  );
  const table = parsedTable.type.create(parsedTable.attrs, [
    header,
    state.schema.nodes.table_row.create(null, cells),
  ]);
  const from = $from.before() - previous.nodeSize;
  const tr = state.tr.replaceWith(from, $from.after(), table);
  view.dispatch(
    tr
      .setSelection(
        TextSelection.create(tr.doc, from + table.firstChild.nodeSize + 4),
      )
      .scrollIntoView(),
  );
  return true;
}
