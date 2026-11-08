import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { IconButton } from "../../ui/primitives.jsx";
import { TerminalProcessIcon, processLabel } from "./terminal-process-icon.jsx";

const widthKey = "cx-terminal-list-width";
function savedWidth() {
  try {
    const scale = JSON.parse(localStorage.getItem(widthKey));
    return typeof scale === "number" && Number.isFinite(scale) && scale > 0
      ? scale
      : null;
  } catch {
    return null;
  }
}

export function TerminalList({ ids, terminals, active, select, terminate }) {
  const container = useRef(),
    guide = useRef(),
    drag = useRef();
  const [scale, setScale] = useState(savedWidth);
  const [layout, setLayout] = useState(null);
  function measure() {
    const style = getComputedStyle(container.current);
    const baseline = guide.current.getBoundingClientRect();
    return {
      width: container.current.getBoundingClientRect().width,
      base: baseline.width,
      min: baseline.height,
      max:
        container.current.parentElement.clientWidth *
        parseFloat(style.getPropertyValue("--terminal-list-limit")),
      step: parseFloat(style.fontSize),
    };
  }
  function changeWidth(width) {
    const next = measure();
    setScale(Math.max(next.min, Math.min(next.max, width)) / next.base);
  }
  function finish(event) {
    const current = drag.current;
    if (
      event?.pointerId !== undefined &&
      current?.pointerId !== event.pointerId
    )
      return;
    drag.current = null;
    document.body.classList.remove("terminal-list-resizing");
    if (current?.element.hasPointerCapture(current.pointerId))
      current.element.releasePointerCapture(current.pointerId);
  }
  useEffect(() => {
    try {
      if (scale === null) localStorage.removeItem(widthKey);
      else localStorage.setItem(widthKey, JSON.stringify(scale));
    } catch {
      // 无法写入浏览器存储时，当前页面仍保留宽度选择。
    }
  }, [scale]);
  useLayoutEffect(() => {
    let previous;
    const update = () => {
      const next = measure();
      if (
        previous &&
        ["base", "min", "max"].some((key) => next[key] !== previous[key])
      )
        finish();
      previous = next;
      setLayout((old) =>
        old && Object.keys(next).every((key) => next[key] === old[key])
          ? old
          : next,
      );
    };
    const observer = new ResizeObserver(update);
    observer.observe(container.current);
    observer.observe(container.current.parentElement);
    observer.observe(guide.current);
    update();
    window.addEventListener("blur", finish);
    return () => {
      observer.disconnect();
      window.removeEventListener("blur", finish);
      finish();
    };
  }, []);
  return (
    <div
      className="terminal-list-container"
      ref={container}
      style={{ "--terminal-list-scale": scale ?? 1 }}
    >
      <span
        className="terminal-list-width-guide"
        ref={guide}
        aria-hidden="true"
      />
      <div
        className="terminal-list-resizer"
        role="separator"
        tabIndex={0}
        aria-label="调整终端列表宽度"
        aria-orientation="vertical"
        aria-valuemin={layout?.min}
        aria-valuemax={layout?.max}
        aria-valuenow={layout?.width}
        title="拖动调整终端列表宽度，双击恢复默认"
        onPointerDown={(event) => {
          if (event.button !== 0 || !event.isPrimary) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            element: event.currentTarget,
            pointerId: event.pointerId,
            x: event.clientX,
            width: measure().width,
          };
          document.body.classList.add("terminal-list-resizing");
        }}
        onPointerMove={(event) => {
          if (drag.current?.pointerId === event.pointerId)
            changeWidth(drag.current.width + drag.current.x - event.clientX);
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
        onLostPointerCapture={finish}
        onDoubleClick={() => setScale(null)}
        onKeyDown={(event) => {
          const next = measure();
          const width = {
            ArrowLeft: next.width + next.step,
            ArrowRight: next.width - next.step,
            Home: next.min,
            End: next.max,
          }[event.key];
          if (width === undefined) return;
          event.preventDefault();
          changeWidth(width);
        }}
      />
      <div className="terminal-list" aria-label="终端列表">
        {ids.map((id, index) => (
          <div className="terminal-row" key={id} data-active={id === active}>
            <button
              className="terminal-tab"
              aria-label={processLabel(terminals[id]?.processName)}
              title={processLabel(terminals[id]?.processName)}
              aria-pressed={id === active}
              onClick={() => select(id)}
            >
              <TerminalProcessIcon name={terminals[id]?.processName} />
              <span className="terminal-name">
                {processLabel(terminals[id]?.processName)}
              </span>
            </button>
            <IconButton
              icon={Trash2}
              title={`结束 ${processLabel(terminals[id]?.processName)}`}
              aria-label={`结束终端 ${index + 1}`}
              onClick={() => terminate(id)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
