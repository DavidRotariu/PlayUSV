import type { Role, User } from '@prisma/client';
import { notFound } from '../lib/errors';
import * as usersRepo from './users.repository';

export const toUserDto = (u: User) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  blocked: u.blocked,
});

/** What other users may see: never the email. */
export const toUserSummary = (u: Pick<User, 'id' | 'name'>) => ({ id: u.id, name: u.name });

export async function list(filters: { role?: Role; blocked?: boolean; search?: string }) {
  return (await usersRepo.list(filters)).map(toUserDto);
}

export async function setBlocked(userId: string, blocked: boolean) {
  if (!(await usersRepo.findById(userId))) throw notFound('Utilizatorul nu a fost găsit.');
  return toUserDto(await usersRepo.update(userId, { blocked }));
}
