// CLI 会话持续持有输入流，轮次空闲时保持打开，直到显式关闭。
export function createInputStream() {
  const pending = [];
  let wake;
  let closed = false;
  return {
    push(message) {
      if (closed) throw new Error("Claude 会话已关闭");
      pending.push(message);
      wake?.();
    },
    close() {
      closed = true;
      wake?.();
    },
    async *[Symbol.asyncIterator]() {
      while (!closed) {
        if (!pending.length) await new Promise((resolve) => (wake = resolve));
        wake = null;
        while (pending.length) yield pending.shift();
      }
    },
  };
}
