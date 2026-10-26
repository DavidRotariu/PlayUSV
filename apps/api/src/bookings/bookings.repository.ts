import type { BookingStatus, CancelledBy, Prisma } from '@prisma/client';
import { prisma, type Tx } from '../lib/prisma';
import { dbDate } from '../lib/time';

type Now = { date: string; minutes: number };

const details = {
  user: { select: { id: true, name: true } },
  unit: { select: { id: true, name: true, facility: { select: { id: true, name: true } } } },
} satisfies Prisma.BookingInclude;

export type BookingWithDetails = Prisma.BookingGetPayload<{ include: typeof details }>;

export const notEnded = (now: Now): Prisma.BookingWhereInput => ({
  OR: [{ date: { gt: dbDate(now.date) } }, { date: dbDate(now.date), endTime: { gt: now.minutes } }],
});

export const ended = (now: Now): Prisma.BookingWhereInput => ({
  OR: [{ date: { lt: dbDate(now.date) } }, { date: dbDate(now.date), endTime: { lte: now.minutes } }],
});

/** Maps the API status to a query; COMPLETED is ACTIVE + ended. */
export const statusWhere = (status: BookingStatus, now: Now): Prisma.BookingWhereInput =>
  status === 'CANCELLED'
    ? { status }
    : { status: 'ACTIVE', ...(status === 'ACTIVE' ? notEnded(now) : ended(now)) };

export const findById = (id: string) => prisma.booking.findUnique({ where: { id }, include: details });

export const list = (where: Prisma.BookingWhereInput, order: Prisma.SortOrder = 'asc') =>
  prisma.booking.findMany({
    where,
    include: details,
    orderBy: [{ date: order }, { startTime: order }, { createdAt: 'asc' }],
  });

/** ACTIVE bookings of the given units on a date (any end time). */
export const activeOnDate = (unitIds: string[], date: string, db: Tx = prisma) =>
  db.booking.findMany({
    where: { unitId: { in: unitIds }, date: dbDate(date), status: 'ACTIVE' },
    include: details,
    orderBy: { createdAt: 'asc' },
  });

export const userActiveOnDate = (userId: string, facilityId: string, date: string, db: Tx = prisma) =>
  db.booking.findMany({
    where: { userId, date: dbDate(date), status: 'ACTIVE', unit: { facilityId } },
  });

export const activeBetweenDates = (
  unitIds: string[],
  from: string,
  to: string,
  now: Now,
  db: Tx = prisma,
) =>
  db.booking.findMany({
    where: {
      unitId: { in: unitIds },
      status: 'ACTIVE',
      date: { gte: dbDate(from), lte: dbDate(to) },
      ...notEnded(now),
    },
    include: details,
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
  });

export const countUpcomingActive = (unitIds: string[], now: Now) =>
  prisma.booking.count({ where: { unitId: { in: unitIds }, status: 'ACTIVE', ...notEnded(now) } });

export const create = (data: Prisma.BookingUncheckedCreateInput, tx: Tx) =>
  tx.booking.create({ data, include: details });

/** Cancels only bookings that are still ACTIVE; returns how many changed. */
export async function cancel(ids: string[], cancelledBy: CancelledBy, db: Tx = prisma) {
  const { count } = await db.booking.updateMany({
    where: { id: { in: ids }, status: 'ACTIVE' },
    data: { status: 'CANCELLED', cancelledBy },
  });
  return count;
}
