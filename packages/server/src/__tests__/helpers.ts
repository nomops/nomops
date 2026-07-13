import request from 'supertest';
import type { Express } from 'express';

/**
 * 测试用户创建助手（对标 n8n 自托管：首个用户 = owner，其余经邀请）。
 * 公开注册 `/auth/register` 只对无用户的实例开放（创建 owner）；此后要靠 owner 邀请。
 */

const PW = 'password-123';

/** 首个用户 = 实例 owner。返回 token + userId。 */
export async function setupOwner(
  app: Express,
  email: string,
  password = PW,
): Promise<{ token: string; userId: string; projectId: string }> {
  const res = await request(app).post('/auth/register').send({ email, password }).expect(201);
  return {
    token: res.body.token as string,
    userId: res.body.user.id as string,
    projectId: res.body.projectId as string,
  };
}

/**
 * 邀请一个用户并立即接受（走真实的 invite → accept 端点），返回其已登录会话。
 * 需传实例 admin/owner 的 token 来发起邀请。
 */
export async function inviteUser(
  app: Express,
  ownerToken: string,
  email: string,
  opts: { role?: 'admin' | 'member'; password?: string } = {},
): Promise<{ token: string; userId: string; projectId: string; inviteToken: string }> {
  const password = opts.password ?? PW;
  const inv = await request(app)
    .post('/api/instance/users/invite')
    .set({ Authorization: `Bearer ${ownerToken}` })
    .send({ email, role: opts.role ?? 'member' })
    .expect(201);
  const inviteToken = new URL(inv.body.inviteLink).searchParams.get('invite') ?? '';
  const accept = await request(app)
    .post(`/auth/invite/${inviteToken}/accept`)
    .send({ password })
    .expect(201);
  return {
    token: accept.body.token as string,
    userId: accept.body.user.id as string,
    projectId: accept.body.projectId as string,
    inviteToken,
  };
}
