import type { User } from '@prisma/client';
import * as bookingsRepo from '../bookings/bookings.repository';
import { toBookingDto } from '../bookings/bookings.service';
import * as facilitiesRepo from '../facilities/facilities.repository';
import { getOrThrow as getFacility } from '../facilities/facilities.service';
import { conflict, notFound } from '../lib/errors';
import { transaction, type Tx } from '../lib/prisma';
import { fromDbDate, nowLocal, toInstant, toLocal } from '../lib/time';
import { toUserSummary } from '../users/users.service';
import * as maintenanceRepo from './maintenance.repository';
import type { BlockWithDetails } from './maintenance.repository';

export type MaintenanceRange = { unitId?: string; startsAt: Date; endsAt: Date };

const toBlockDto = (b: BlockWithDetails) => ({
  id: b.id,
  facilityId: b.facilityId,
  unitId: b.unitId,
  startsAt: b.startsAt.toISOString(),
  endsAt: b.endsAt.toISOString(),
  reason: b.reason,
  createdBy: toUserSummary(b.createdBy),
});

async function facilityAndUnit(facilityId: string, unitId?: string) {
  const facility = await getFacility(facilityId);
  if (unitId && !facility.units.some((u) => u.id === unitId)) {
    throw notFound('Terenul nu a fost găsit.');
  }
  return facility;
}

/** ACTIVE, not yet ended bookings of the units that overlap [startsAt, endsAt). */
async function affectedBookings(unitIds: string[], r: MaintenanceRange, db?: Tx) {
  const candidates = await bookingsRepo.activeBetweenDates(
    unitIds,
    toLocal(r.startsAt).date,
    toLocal(r.endsAt).date,
    nowLocal(),
    db,
  );
  return candidates.filter((b) => {
    const date = fromDbDate(b.date);
    return toInstant(date, b.startTime) < r.endsAt && toInstant(date, b.endTime) > r.startsAt;
  });
}

export async function list(facilityId: string) {
  await getFacility(facilityId);
  return (await maintenanceRepo.listForFacility(facilityId)).map(toBlockDto);
}

export async function preview(facilityId: string, r: MaintenanceRange) {
  const facility = await facilityAndUnit(facilityId, r.unitId);
  const unitIds = r.unitId ? [r.unitId] : facility.units.map((u) => u.id);
  return (await affectedBookings(unitIds, r)).map((b) => toBookingDto(b));
}

/**
 * Locks every unit of the facility so no booking can commit inside the block while it is
 * being created, then cancels the affected bookings in the same transaction.
 */
export async function create(actor: User, facilityId: string, r: MaintenanceRange & { reason?: string }) {
  await facilityAndUnit(facilityId, r.unitId);
  return transaction(async (tx) => {
    const unitIds = await facilitiesRepo.lockUnitsOfFacility(tx, facilityId);
    if ((await maintenanceRepo.overlapping(facilityId, r.unitId, r.startsAt, r.endsAt, tx)).length) {
      throw conflict('MAINTENANCE_OVERLAP', 'Perioada se suprapune cu o altă perioadă de mentenanță.');
    }
    const block = await maintenanceRepo.create(
      {
        facilityId,
        unitId: r.unitId ?? null,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        reason: r.reason ?? null,
        createdById: actor.id,
      },
      tx,
    );
    const affected = await affectedBookings(r.unitId ? [r.unitId] : unitIds, r, tx);
    await bookingsRepo.cancel(
      affected.map((b) => b.id),
      'MAINTENANCE',
      tx,
    );
    return {
      block: toBlockDto(block),
      cancelledBookings: affected.map((b) =>
        toBookingDto({ ...b, status: 'CANCELLED', cancelledBy: 'MAINTENANCE' }),
      ),
    };
  });
}

/** Ends the block; cancelled bookings stay cancelled. */
export async function remove(blockId: string) {
  if (!(await maintenanceRepo.findById(blockId))) {
    throw notFound('Perioada de mentenanță nu a fost găsită.');
  }
  await maintenanceRepo.remove(blockId);
}
