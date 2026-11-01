import test from "node:test";
import assert from "node:assert/strict";
import { turnElapsedMs, formatElapsed } from "../src/domain/turn-timing.js";

test("运行耗时从轮次开始时间计算，跨分钟和小时显示", () => {
  assert.equal(turnElapsedMs({ startedAt: 100 }, true, 161900), 61900);
  assert.equal(formatElapsed(61900), "1分1秒");
  assert.equal(formatElapsed(3661000), "1小时1分1秒");
  assert.equal(formatElapsed(3600000), "1小时0分0秒");
  assert.equal(formatElapsed(59999), "59秒");
  assert.equal(formatElapsed(0), "0秒");
});

test("完成后优先显示后端毫秒耗时，浏览器时间推进仍保持固定", () => {
  const timing = { startedAt: 100, completedAt: 166, durationMs: 65800 };
  assert.equal(turnElapsedMs(timing, false, 200000), 65800);
  assert.equal(turnElapsedMs(timing, false, 300000), 65800);
  assert.equal(formatElapsed(turnElapsedMs(timing, false, 300000)), "1分5秒");
  assert.equal(turnElapsedMs({ durationMs: 0 }, false, 300000), 0);
});

test("历史耗时可由开始和结束时间恢复，失败及中断沿用相同计算", () => {
  for (const status of ["completed", "failed", "interrupted"])
    assert.equal(
      turnElapsedMs(
        { status, startedAt: 100, completedAt: 163 },
        false,
        999000,
      ),
      63000,
    );
});

test("缺少时间记录的历史保持空值，时钟偏移时耗时从零开始", () => {
  assert.equal(turnElapsedMs(undefined, false, 200000), null);
  assert.equal(turnElapsedMs({ startedAt: null }, true, 200000), null);
  assert.equal(turnElapsedMs({ startedAt: 100 }, false, 200000), null);
  assert.equal(turnElapsedMs({ startedAt: 201 }, true, 200000), 0);
});
