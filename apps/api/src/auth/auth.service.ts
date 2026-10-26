import type { Role, User } from '@prisma/client';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { AppError, accountBlocked, unauthorized } from '../lib/errors';
import * as usersRepo from '../users/users.repository';

const google = new OAuth2Client();

export function roleForEmail(email: string): Role | null {
  if (config.adminEmails.includes(email)) return 'ADMIN';
  if (email.endsWith('@student.usv.ro')) return 'STUDENT';
  if (email.endsWith('@usm.ro')) return 'TEACHER';
  return null;
}

export const signToken = (user: Pick<User, 'id'>) =>
  jwt.sign({}, config.jwtSecret, { subject: user.id, expiresIn: '7d' });

export function verifyToken(token: string): string {
  try {
    const sub = jwt.verify(token, config.jwtSecret).sub;
    if (typeof sub === 'string') return sub;
  } catch {
    // fall through
  }
  throw unauthorized();
}

/** Finds or creates the account; the role follows the email domain and ADMIN_EMAILS on every login. */
export async function login(rawEmail: string, name: string) {
  const email = rawEmail.trim().toLowerCase();
  const role = roleForEmail(email);
  if (!role) {
    throw new AppError(403, 'DOMAIN_NOT_ALLOWED', 'Folosește un cont @student.usv.ro sau @usm.ro.');
  }
  const existing = await usersRepo.findByEmail(email);
  if (existing?.blocked) throw accountBlocked();
  const user = existing
    ? existing.role === role
      ? existing
      : await usersRepo.update(existing.id, { role })
    : await usersRepo.create({ email, name, role });
  return { token: signToken(user), user };
}

export async function loginWithGoogle(idToken: string) {
  let payload;
  try {
    payload = (
      await google.verifyIdToken({ idToken, audience: config.googleClientId })
    ).getPayload();
  } catch {
    throw unauthorized('Autentificarea Google a eșuat. Încearcă din nou.');
  }
  if (!payload?.email || !payload.email_verified) {
    throw unauthorized('Autentificarea Google a eșuat. Încearcă din nou.');
  }
  return login(payload.email, payload.name ?? payload.email.split('@')[0]);
}
