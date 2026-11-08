import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

const heightKey = "cx-terminal-height";
function savedHeight() {
  try {
    const ratio = JSON.parse(localStorage.getItem(heightKey));
    return typeof ratio === "number" && Number.isFinite(ratio) && ratio > 0
      ? ratio
      : null;
  } catch {
    return null;
  }
}

export function TerminalFrame({ children }) {
  const panel = useRef(),
    guide = useRef(),
    drag = useRef();
  const [ratio, setRatio] = useState(savedHeight);
  const [layout, setLayout] = useState(null);
  function measure() {
    const parent = panel.current.parentElement;
    const workspace = parent.querySelector(".workspace");
    const footer = parent.querySelector(".conversation-footer");
    const baseline = guide.current.getBoundingClientRect();
    const height = panel.current.getBoundingClientRect().height;
    const available = height + (workspace?.getBoundingClientRect().height || 0);
    const reserve = Math.max(
      baseline.height,
      footer?.getBoundingClientRect().height || 0,
    );
    return {
      height,
      available,
      min: baseline.width,
      max: Math.max(baseline.width, available - reserve),
      step: parseFloat(getComputedStyle(panel.current).fontSize),
    };
  }
  function changeHeight(height) {
    const next = measure();
    setRatio(Math.max(next.min, Math.min(next.max, height)) / next.available);
  }
  function finish(event) {
    const current = drag.current;
    if (
      event?.pointerId !== undefined &&
      current?.pointerId !== event.pointerId
    )
      return;
    drag.current = null;
    document.body.classList.remove("terminal-height-resizing");
    if (current?.element.hasPointerCapture(current.pointerId))
      current.element.releasePointerCapture(current.pointerId);
  }
  useEffect(() => {
    try {
      if (ratio === null) localStorage.removeItem(heightKey);
      else localStorage.setItem(heightKey, JSON.stringify(ratio));
    } catch {
      // 浏览器存储不可用时，当前页面仍保留高度选择。
    }
  }, [ratio]);
  useLayoutEffect(() => {
    let previous;
    const update = () => {
      const next = measure();
      if (
        previous &&
        ["available", "min", "max"].some(
          (key) => Math.abs(next[key] - previous[key]) > 0.5,
        )
      )
        finish();
      previous = next;
      setLayout((old) =>
        old && Object.keys(next).every((key) => old[key] === next[key])
          ? old
          : next,
      );
    };
    const observer = new ResizeObserver(update);
    observer.observe(panel.current.parentElement);
    observer.observe(panel.current);
    observer.observe(guide.current);
    const footer = panel.current.parentElement.querySelector(
      ".conversation-footer",
    );
    if (footer) observer.observe(footer);
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
      className="terminal-panel"
      ref={panel}
      style={{
        "--terminal-height-max": layout ? layout.max + "px" : undefined,
        "--terminal-preferred-height":
          ratio !== null && layout
            ? ratio * layout.available + "px"
            : undefined,
      }}
    >
      <span ref={guide} className="terminal-height-guide" aria-hidden="true" />
      <div
        className="terminal-height-resizer"
        role="separator"
        tabIndex={0}
        aria-label="调整终端面板高度"
        aria-orientation="horizontal"
        aria-valuemin={layout?.min}
        aria-valuemax={layout?.max}
        aria-valuenow={layout?.height}
        title="拖动调整终端高度，双击恢复默认"
        onPointerDown={(event) => {
          if (event.button !== 0 || !event.isPrimary) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            element: event.currentTarget,
            pointerId: event.pointerId,
            y: event.clientY,
            height: measure().height,
          };
          document.body.classList.add("terminal-height-resizing");
        }}
        onPointerMove={(event) => {
          if (drag.current?.pointerId === event.pointerId)
            changeHeight(drag.current.height + drag.current.y - event.clientY);
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
        onLostPointerCapture={finish}
        onDoubleClick={() => setRatio(null)}
        onKeyDown={(event) => {
          const next = measure();
          const height = {
            ArrowUp: next.height + next.step,
            ArrowDown: next.height - next.step,
            Home: next.min,
            End: next.max,
          }[event.key];
          if (height === undefined) return;
          event.preventDefault();
          changeHeight(height);
        }}
      />
      {children}
    </div>
  );
}
