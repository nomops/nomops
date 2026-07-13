// 把 server + 所有 @nomops/* 工作区包打成一个自包含、可发布到 npm 的单包。
//
// 做法：esbuild 把第一方代码（server 源码 + @nomops/workflow|core|nodes|db）全部
// 内联进 dist/main.js 与 dist/worker.js；所有第三方 npm 包保持 external，由生成的
// package.json 以真实版本声明为 dependencies，`npm install` 时从 registry 拉取。
// 这样发布物不含 `workspace:*`，也不需要把内部包逐个发到 npm。
//
// 产物布局（migrate.ts 以 `../migrations` 解析、main.ts 以 `../frontend/dist` 兜底，
// 均相对 dist/ 成立）：
//   dist-standalone/
//     package.json  bin/nomops.js
//     dist/main.js  dist/worker.js
//     migrations/{sqlite,pg}/   frontend/dist/
//
// 用法：node scripts/build-standalone.mjs   （版本取环境变量 NOMOPS_VERSION，缺省 0.0.0）

import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  chmodSync,
  readFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SERVER = join(ROOT, 'packages/server');
const OUT = join(ROOT, 'dist-standalone');
const require = createRequire(join(SERVER, 'package.json'));

const BUILTINS = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);
const isFirstParty = (p) => p.startsWith('@nomops/');
const isRelative = (p) => p.startsWith('.') || p.startsWith('/');

// 从 import 路径归约出包名：@scope/name/sub → @scope/name；name/sub → name。
function pkgNameOf(spec) {
  const parts = spec.split('/');
  return spec.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
}

/** 记录并 external 掉所有第三方裸依赖；builtins / 相对路径 / @nomops/* 交回 esbuild 打包。 */
const externals = new Set();
const collectExternalsPlugin = {
  name: 'collect-externals',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /.*/ }, (a) => {
      const p = a.path;
      if (isRelative(p) || BUILTINS.has(p) || isFirstParty(p)) return undefined;
      externals.add(pkgNameOf(p));
      return { path: p, external: true };
    });
  },
};

async function bundle(entry, outfile) {
  await build({
    entryPoints: [join(SERVER, entry)],
    outfile: join(OUT, outfile),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    // esm bundle 里 import.meta.url 指向输出文件本身，migrate.ts / main.ts 的相对解析据此成立
    plugins: [collectExternalsPlugin],
    logLevel: 'warning',
  });
}

// 1) 清理输出目录
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'dist'), { recursive: true });

// 2) 打包两个入口（external 集合在此期间被填充）
await bundle('src/main.ts', 'dist/main.js');
await bundle('src/worker.ts', 'dist/worker.js');

// 3) 汇总所有第一方包声明的依赖范围（权威、对应 lockfile 意图）
const declaredRanges = {};
for (const p of ['workflow', 'core', 'nodes', 'db', 'server']) {
  const pj = JSON.parse(readFileSync(join(ROOT, 'packages', p, 'package.json'), 'utf8'));
  Object.assign(declaredRanges, pj.dependencies ?? {}, pj.devDependencies ?? {});
}

// 每个 external：优先用声明范围；缺失时回退到已安装版本
const dependencies = {};
for (const name of [...externals].sort()) {
  if (declaredRanges[name] && !declaredRanges[name].startsWith('workspace:')) {
    dependencies[name] = declaredRanges[name];
    continue;
  }
  try {
    const pj = JSON.parse(readFileSync(require.resolve(`${name}/package.json`), 'utf8'));
    dependencies[name] = `^${pj.version}`;
  } catch {
    throw new Error(`无法解析 external 依赖版本：${name}（不在任何第一方包依赖里）`);
  }
}

// 4) 拷 migrations（跟随 dist/ 上一级）与前端产物
cpSync(join(ROOT, 'packages/db/migrations'), join(OUT, 'migrations'), { recursive: true });
const frontendDist = join(ROOT, 'packages/frontend/dist');
if (!existsSync(frontendDist)) {
  throw new Error('缺少 packages/frontend/dist —— 先跑 pnpm build 再打包');
}
cpSync(frontendDist, join(OUT, 'frontend/dist'), { recursive: true });

// 5) bin
mkdirSync(join(OUT, 'bin'), { recursive: true });
const binPath = join(OUT, 'bin/nomops.js');
writeFileSync(binPath, "#!/usr/bin/env node\nimport '../dist/main.js';\n");
chmodSync(binPath, 0o755);

// 6) 生成干净的 package.json（name:nomops，真实版本，无 workspace:*）
const version = process.env.NOMOPS_VERSION?.replace(/^v/, '') || '0.0.0';
const pkg = {
  name: 'nomops',
  version,
  description: 'Node-based workflow automation you can self-host.',
  type: 'module',
  license: 'SEE LICENSE IN LICENSE',
  homepage: 'https://github.com/nomops/nomops',
  repository: { type: 'git', url: 'git+https://github.com/nomops/nomops.git' },
  engines: { node: '>=22' },
  bin: { nomops: './bin/nomops.js' },
  main: './dist/main.js',
  files: ['dist', 'bin', 'migrations', 'frontend'],
  scripts: { start: 'node dist/main.js' },
  dependencies,
};
writeFileSync(join(OUT, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

// 7) 附上 README 与 LICENSE（若存在）
for (const f of ['README.md', 'LICENSE']) {
  const from = join(ROOT, f);
  if (existsSync(from)) cpSync(from, join(OUT, f));
}

console.log(`✓ standalone 包已生成：${OUT}`);
console.log(`  name=nomops version=${version}`);
console.log(`  external deps (${Object.keys(dependencies).length}): ${Object.keys(dependencies).join(', ')}`);
