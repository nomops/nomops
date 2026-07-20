# License 签发（仅签发方）

本仓库**只验签，不签发**。签发工具与私钥都在独立的私有仓库，不在这里。

## 为什么

如果签发脚本和公钥覆盖开关都留在产品仓库里，任何人可以：

```
keygen → 自签一张 plan:"Enterprise"、validTo:"2099" 的证书
       → 把公钥指向自己 → 全功能解锁
```

不用改代码、不用重新构建。那样验签形同虚设。所以：

- 公钥**编译进产物**（`packages/server/src/license/license-cert.ts` 的
  `LICENSE_PUBLIC_KEY`），**没有环境变量覆盖**；
- 签发脚本**不在本仓库**。

绕过因此至少需要改源码 + 重新构建。这拦不住有动机的人——开源产品做不到——
但它把「顺手绕过」挡在门外，并让绕过成为可举证的改动行为，而非一次合法配置。

## 签发方需要什么

私有签发仓库里保留两个脚本（本仓库历史中曾短暂存在，见 `feat/b-series` 分支
移除记录），依赖只有 Node 标准库：

- `license-keygen.mjs` —— 生成 Ed25519 密钥对
- `license-sign.mjs` —— 用私钥签发证书

签发命令形如：

```bash
NOMOPS_LICENSE_PRIVATE_KEY=<base64 pkcs8 私钥> \
node license-sign.mjs \
  --plan Business \
  --features rbac,auditLogs,sso,ldap,sourceControl \
  --quotas teamProjects=6,users=-1 \
  --days 365 \
  --to "客户名"
```

## 轮换公钥

1. `license-keygen.mjs` 生成新密钥对；
2. 新公钥替换 `LICENSE_PUBLIC_KEY`，发版；
3. 用新私钥给存量客户重签证书并下发。

★ 换公钥会让**所有旧证书立即失效**，必须先完成重签再发版。

## 证书格式

见 `docs/06-ENTERPRISE.md` 第七节。
