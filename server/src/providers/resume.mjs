import { setTimeout as delay } from "node:timers/promises";

// Codex 发出关闭通知后，线程资源的异步回收仍可能短暂拒绝恢复。
export async function resumeAfterClose(call, params) {
  const deadline = Date.now() + 30000;
  for (;;) {
    try {
      return await call("thread/resume", params);
    } catch (error) {
      if (
        !/is closing; retry thread\/resume after the thread is closed/.test(
          error.message,
        ) ||
        Date.now() >= deadline
      )
        throw error;
      await delay(100);
    }
  }
}
