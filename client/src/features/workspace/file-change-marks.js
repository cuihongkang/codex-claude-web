import { StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { fileChangeHighlights } from "../../domain/file-changes.js";

class RemovedLines extends WidgetType {
  constructor(group) {
    super();
    this.group = group;
  }
  eq(other) {
    return JSON.stringify(this.group) === JSON.stringify(other.group);
  }
  toDOM() {
    const block = document.createElement("div");
    block.className = "cm-file-change-removed";
    block.contentEditable = "false";
    block.setAttribute("aria-label", "本轮删除的内容");
    this.group.lines.forEach((text, index) => {
      const row = document.createElement("div");
      const number = document.createElement("span");
      number.className = "cm-file-change-old-line";
      number.textContent = String(this.group.oldLine + index);
      const content = document.createElement("span");
      content.textContent = "− " + text;
      row.append(number, content);
      block.append(row);
    });
    return block;
  }
  ignoreEvent() {
    return true;
  }
}

// 删除内容作为只读装饰显示，编辑和保存始终使用当前文件的文档内容。
export function fileChangeMarks(diff, patches) {
  return StateField.define({
    create(state) {
      const marks = fileChangeHighlights(state.doc.toString(), diff, patches);
      const ranges = marks.added.map((line) =>
        Decoration.line({ class: "cm-file-change-added" }).range(
          state.doc.line(line).from,
        ),
      );
      for (const group of marks.removed) {
        const atEnd = group.line > state.doc.lines;
        const position = atEnd
          ? state.doc.length
          : state.doc.line(group.line).from;
        ranges.push(
          Decoration.widget({
            widget: new RemovedLines(group),
            block: true,
            side: atEnd ? 1 : -1,
          }).range(position),
        );
      }
      return Decoration.set(ranges, true);
    },
    update(marks, transaction) {
      return marks.map(transaction.changes);
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}
