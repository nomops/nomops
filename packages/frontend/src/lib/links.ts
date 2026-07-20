/**
 * 全部对外链接的单一出处。
 *
 * 集中在这里有两个理由：
 * 1. 去品牌化时曾把 URL **内部**的品牌串也替换掉，产出带中文域名的死链
 *    （`docs.<中文>.io` 形态）发到了用户面前。链接散在十几个 .vue 里就必然重演。
 * 2. 自有站点还不存在，这些暂时指向仓库。域名上线后只改这一个文件。
 */

export const REPO_URL = 'https://github.com/nomops/nomops';

export const LINKS = {
  /** 套餐与定价。★自有定价页上线后改这里。 */
  pricing: `${REPO_URL}#plans`,
  /** 文档根。 */
  docs: `${REPO_URL}/tree/main/docs`,
  /** 表达式语法。 */
  docsExpressions: `${REPO_URL}/tree/main/docs/03-MODULES.md`,
  /** 源码控制与多环境。 */
  docsSourceControl: `${REPO_URL}/tree/main/docs/06-ENTERPRISE.md`,

  quickstart: `${REPO_URL}#quick-start`,
  forum: `${REPO_URL}/discussions`,
  course: `${REPO_URL}/tree/main/docs/README.md`,
  reportBug: `${REPO_URL}/issues/new?labels=bug-report`,
  changelog: `${REPO_URL}/releases`,
} as const;
