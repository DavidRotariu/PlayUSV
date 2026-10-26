import type { BookingStatus, Prisma, User } from '@prisma/client';
import { config } from '../config';
import * as facilitiesRepo from '../facilities/facilities.repository';
import { accountBlocked, conflict, forbidden, notFound } from '../lib/errors';
import { transaction } from '../lib/prisma';
import {
  daysBetween,
  dbDate,
  fromDbDate,
  hasEnded,
  nowLocal,
  toEndMinutes,
  toHHMM,
  toInstant,
  toMinutes,
} from '../lib/time';
import * as maintenanceRepo from '../maintenance/maintenance.repository';
import * as usersRepo from '../users/users.repository';
import { toUserSummary } from '../users/users.service';
import * as bookingsRepo from './bookings.repository';
import type { BookingWithDetails } from './bookings.repository';
import { checkBookingRules } from './bookings.rules';

export function toBookingDto(b: BookingWithDetails, now = nowLocal()) {
  const date = fromDbDate(b.date);
  return {
    id: b.id,
    user: toUserSummary(b.user),
    facilityId: b.unit.facility.id,
    facilityName: b.unit.facility.name,
    unitId: b.unit.id,
    unitName: b.unit.name,
    date,
    startTime: toHHMM(b.startTime),
    endTime: toHHMM(b.endTime),
    status: b.status === 'ACTIVE' && hasEnded(date, b.endTime, now) ? 'COMPLETED' : b.status,
    cancelledBy: b.cancelledBy,
    createdAt: b.createdAt.toISOString(),
  };
}

export type BookingCreate = {
  unitId: string;
  date: string;
  startTime: string;
  endTime: string;
  userId?: string;
};

/**
 * Checks and insert run in one transaction holding row locks on the user (daily limit,
 * own overlaps) and then the unit (capacity). Concurrent bookings for the same unit or
 * user queue on those locks, so each one sees the rows committed before it.
 * Always lock user before unit to avoid deadlocks.
 */
export async function create(actor: User, input: BookingCreate) {
  if (input.userId && input.userId !== actor.id && actor.role !== 'ADMIN') {
    throw forbidden('Doar administratorii pot rezerva în numele altui utilizator.');
  }
  const start = toMinutes(input.startTime);
  const end = toEndMinutes(input.endTime);

  return transaction(async (tx) => {
    const user = await usersRepo.lockById(tx, input.userId ?? actor.id);
    if (!user) throw notFound('Utilizatorul nu a fost găsit.');
    if (user.blocked) throw accountBlocked('Contul utilizatorului este blocat.');
    const unit = await facilitiesRepo.lockUnit(tx, input.unitId);
    if (!unit) throw notFound('Terenul nu a fost găsit.');

    const userBookings = await bookingsRepo.userActiveOnDate(user.id, unit.facilityId, input.date, tx);
    const unitBookings = await bookingsRepo.activeOnDate([unit.id], input.date, tx);
    const blocks = await maintenanceRepo.overlapping(
      unit.facilityId,
      unit.id,
      toInstant(input.date, start),
      toInstant(input.date, end),
      tx,
    );

    checkBookingRules({
      role: user.role,
      facility: unit.facility,
      date: input.date,
      start,
      end,
      now: nowLocal(),
      maxDaysAhead: config.maxDaysAhead,
      userBookings,
      unitBookings,
      inMaintenance: blocks.length > 0,
    });

    const booking = await bookingsRepo.create(
      { userId: user.id, unitId: unit.id, date: dbDate(input.date), startTime: start, endTime: end },
      tx,
    );
    return toBookingDto(booking);
  });
}

export async function listMine(user: User, scope: 'upcoming' | 'past') {
  const now = nowLocal();
  const where = scope === 'upcoming' ? bookingsRepo.notEnded(now) : bookingsRepo.ended(now);
  const bookings = await bookingsRepo.list({ userId: user.id, ...where }, scope === 'upcoming' ? 'asc' : 'desc');
  return bookings.map((b) => toBookingDto(b, now));
}

export async function list(filters: {
  facilityId?: string;
  date?: string;
  userId?: string;
  status?: BookingStatus;
}) {
  const now = nowLocal();
  const where: Prisma.BookingWhereInput = {
    userId: filters.userId,
    ...(filters.facilityId && { unit: { facilityId: filters.facilityId } }),
    ...(filters.date && { date: dbDate(filters.date) }),
  };
  const bookings = await bookingsRepo.list(
    filters.status ? { AND: [where, bookingsRepo.statusWhere(filters.status, now)] } : where,
  );
  return bookings.map((b) => toBookingDto(b, now));
}

async function getOwnedOrAdmin(actor: User, id: string) {
  const booking = await bookingsRepo.findById(id);
  if (!booking) throw notFound('Rezervarea nu a fost găsită.');
  if (booking.userId !== actor.id && actor.role !== 'ADMIN') {
    throw forbidden('Nu ai acces la rezervarea altui utilizator.');
  }
  return booking;
}

export const get = async (actor: User, id: string) => toBookingDto(await getOwnedOrAdmin(actor, id));

/** Users cancel their own bookings until the cutoff before start; admins any booking not yet ended. */
export async function cancel(actor: User, id: string) {
  const booking = await getOwnedOrAdmin(actor, id);
  const notCancellable = (message: string) => conflict('BOOKING_NOT_CANCELLABLE', message);
  if (booking.status === 'CANCELLED') throw notCancellable('Rezervarea este deja anulată.');

  const now = nowLocal();
  const date = fromDbDate(booking.date);
  if (hasEnded(date, booking.endTime, now)) throw notCancellable('Rezervarea s-a încheiat.');
  const minutesToStart = daysBetween(now.date, date) * 1440 + booking.startTime - now.minutes;
  if (actor.role !== 'ADMIN' && (minutesToStart <= 0 || minutesToStart < config.cancelCutoffMinutes)) {
    throw notCancellable('Rezervarea a început sau termenul de anulare a trecut.');
  }

  const isOwner = booking.userId === actor.id;
  if (!(await bookingsRepo.cancel([id], isOwner ? 'USER' : 'ADMIN'))) {
    throw notCancellable('Rezervarea este deja anulată.');
  }
  return toBookingDto((await bookingsRepo.findById(id))!);
}
