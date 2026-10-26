import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../src/app';
import { bearer, createUser, prisma, resetDb } from '../helpers';

// The fake Google token is "email|name"; anything starting with "bad" fails verification.
vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    async verifyIdToken({ idToken }: { idToken: string }) {
      if (idToken.startsWith('bad')) throw new Error('invalid token');
      const [email, name] = idToken.split('|');
      return { getPayload: () => ({ email, name, email_verified: true }) };
    }
  },
}));

const login = (idToken: string) => request(app).post('/api/auth/google').send({ idToken });

beforeEach(resetDb);

describe('POST /auth/google', () => {
  it('creates a student on first login and returns a working JWT', async () => {
    const res = await login('ana.pop@student.usv.ro|Ana Pop');
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      email: 'ana.pop@student.usv.ro',
      name: 'Ana Pop',
      role: 'STUDENT',
      blocked: false,
    });

    const me = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${res.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(res.body.user.id);

    await login('ana.pop@student.usv.ro|Ana Pop');
    expect(await prisma.user.count()).toBe(1);
  });

  it('maps @usm.ro to TEACHER and ADMIN_EMAILS to ADMIN', async () => {
    expect((await login('prof@usm.ro|Prof')).body.user.role).toBe('TEACHER');
    expect((await login('admin@usm.ro|Admin')).body.user.role).toBe('ADMIN');
  });

  it('rejects other domains with DOMAIN_NOT_ALLOWED', async () => {
    for (const email of ['x@gmail.com', 'x@usv.ro', 'x@evil.student.usv.ro']) {
      const res = await login(`${email}|X`);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('DOMAIN_NOT_ALLOWED');
    }
    expect(await prisma.user.count()).toBe(0);
  });

  it('rejects an invalid Google token with 401', async () => {
    const res = await login('bad-token');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('rejects blocked accounts at login and on every request', async () => {
    const user = await createUser('STUDENT', { email: 'blocat@student.usv.ro' });
    const token = bearer(user);
    await prisma.user.update({ where: { id: user.id }, data: { blocked: true } });

    const res = await login('blocat@student.usv.ro|Blocat');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      code: 'ACCOUNT_BLOCKED',
      message: 'Contul tău a fost blocat de administrator.',
    });

    const me = await request(app).get('/api/facilities').set('Authorization', token);
    expect(me.status).toBe(403);
    expect(me.body.code).toBe('ACCOUNT_BLOCKED');
  });

  it('requires a token and does not expose dev-login outside development', async () => {
    expect((await request(app).get('/api/users/me')).body.code).toBe('UNAUTHORIZED');
    const res = await request(app).post('/api/auth/dev-login').send({ email: 'a@usm.ro' });
    expect(res.status).not.toBe(200);
  });
});

describe('users (admin)', () => {
  it('lists, searches and blocks users; blocking takes effect immediately', async () => {
    const admin = await createUser('ADMIN');
    const student = await createUser('STUDENT', { name: 'Maria Ionescu' });
    await createUser('TEACHER');

    const forbidden = await request(app).get('/api/users').set('Authorization', bearer(student));
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.code).toBe('FORBIDDEN');

    const list = await request(app)
      .get('/api/users?role=STUDENT&search=ionescu')
      .set('Authorization', bearer(admin));
    expect(list.body.map((u: { id: string }) => u.id)).toEqual([student.id]);

    const blocked = await request(app)
      .patch(`/api/users/${student.id}/block`)
      .set('Authorization', bearer(admin))
      .send({ blocked: true });
    expect(blocked.body.blocked).toBe(true);

    const after = await request(app).get('/api/users/me').set('Authorization', bearer(student));
    expect(after.body.code).toBe('ACCOUNT_BLOCKED');

    const missing = await request(app)
      .patch('/api/users/00000000-0000-4000-8000-000000000000/block')
      .set('Authorization', bearer(admin))
      .send({ blocked: true });
    expect(missing.status).toBe(404);
  });
});
