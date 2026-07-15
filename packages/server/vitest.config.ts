import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 部分集成测试每个用例起多个 bootstrap（+ 真实 git / PGlite），全并行会吃满内存。
    // 限制并发 worker，既防 OOM 又减 CPU 争用导致的超时抖动。
    maxWorkers: 4,
    minWorkers: 1,
    // 源码同步等重测试（真实 git + 多 bootstrap）放宽默认超时
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
