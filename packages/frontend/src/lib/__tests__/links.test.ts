import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { LINKS, REPO_URL } from '../links.js';

/**
 * 对外链接的回归锁。
 *
 * 起因：去品牌化脚本把 URL **内部**的品牌串一并替换了，产出带中文域名的
 * 死链发到了用户面前，而且散在 5 个文件里没人发现。
 * 人是记不住这种事的，交给测试守。
 */
// vitest 的 cwd 是包根;jsdom 环境下 import.meta.url 不是 file URL,用不了
const SRC = join(process.cwd(), 'src');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      out.push(...sourceFiles(full));
    } else if (/\.(vue|ts)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const files = sourceFiles(SRC);
/** 只看 URL 字面量，避开注释里合法出现的中文。 */
const urlPattern = /https?:\/\/[^\s"'`)<>]+/g;
/** 拼出来而非写死，否则本文件会把自己判为违规。 */
const BRAND = new RegExp(['n', '8', 'n'].join(''), 'i');

describe('对外链接', () => {
  it('源码里扫不到域名被改坏的 URL（死链的形态）', () => {
    const broken: string[] = [];
    for (const file of files) {
      for (const url of readFileSync(file, 'utf8').match(urlPattern) ?? []) {
        // 只查主机名:路径里出现 … 之类的占位符是合法的(placeholder 文案)
        const host = url.split('//')[1]?.split('/')[0] ?? '';
        if (!/^[a-zA-Z0-9.:-]*$/.test(host)) broken.push(`${file.slice(SRC.length)}: ${url}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('★源码里不出现对标产品品牌串（命名铁律）', () => {
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      if (BRAND.test(text)) hits.push(file.slice(SRC.length));
    }
    expect(hits).toEqual([]);
  });

  it('全部链接都挂在自有仓库下（自有域名上线前的过渡态）', () => {
    for (const [name, url] of Object.entries(LINKS)) {
      expect(url, name).toContain(REPO_URL);
    }
  });

  it('链接值互不重复地指向有意义的路径（不是复制粘贴的占位）', () => {
    expect(new Set(Object.values(LINKS)).size).toBe(Object.keys(LINKS).length);
  });
});
