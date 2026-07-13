#!/usr/bin/env node
// nomops CLI 入口（npm/全局安装后的 `nomops` 命令）。
// 仅是带 shebang 的薄包装：真正的启动逻辑在编译产物 dist/main.js。
import '../dist/main.js';
