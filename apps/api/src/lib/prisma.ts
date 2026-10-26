import { Prisma, PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

export type Tx = Prisma.TransactionClient;

export function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  // Requests queue on row locks, so allow a little more than the 2s/5s defaults.
  return prisma.$transaction(fn, { maxWait: 10_000, timeout: 15_000 });
}
