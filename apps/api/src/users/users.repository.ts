import type { Prisma, Role, User } from '@prisma/client';
import { prisma, type Tx } from '../lib/prisma';

export const findById = (id: string) => prisma.user.findUnique({ where: { id } });

export const findByEmail = (email: string) => prisma.user.findUnique({ where: { email } });

export const create = (data: Prisma.UserCreateInput) => prisma.user.create({ data });

export const update = (id: string, data: Prisma.UserUpdateInput) =>
  prisma.user.update({ where: { id }, data });

/** Row lock that serializes one user's bookings (daily limit, own overlaps). */
export async function lockById(tx: Tx, id: string): Promise<User | null> {
  const rows = await tx.$queryRaw<User[]>`SELECT * FROM "User" WHERE id = ${id}::uuid FOR UPDATE`;
  return rows[0] ?? null;
}

export const list = (filters: { role?: Role; blocked?: boolean; search?: string }) =>
  prisma.user.findMany({
    where: {
      role: filters.role,
      blocked: filters.blocked,
      ...(filters.search && {
        OR: [
          { name: { contains: filters.search, mode: 'insensitive' } },
          { email: { contains: filters.search, mode: 'insensitive' } },
        ],
      }),
    },
    orderBy: { name: 'asc' },
  });
