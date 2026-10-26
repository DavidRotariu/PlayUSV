import type { FacilityType, User } from '@prisma/client';
import * as bookingsRepo from '../bookings/bookings.repository';
import { STUDENT_EARLIEST_START } from '../bookings/bookings.rules';
import { config } from '../config';
import { conflict, notFound } from '../lib/errors';
import {
  daysBetween,
  nowLocal,
  SLOT,
  toEndMinutes,
  toHHMM,
  toInstant,
  toMinutes,
} from '../lib/time';
import * as maintenanceRepo from '../maintenance/maintenance.repository';
import { toUserSummary } from '../users/users.service';
import * as facilitiesRepo from './facilities.repository';
import type { FacilityWithUnits } from './facilities.repository';

export type FacilityInput = {
  name: string;
  type: FacilityType;
  openTime: string;
  closeTime: string;
  capacityPerSlot: number;
  studentDailyLimitMinutes: number;
  unitNames: string[];
};

export const toFacilityDto = (f: FacilityWithUnits) => ({
  id: f.id,
  name: f.name,
  type: f.type,
  openTime: toHHMM(f.openTime),
  closeTime: toHHMM(f.closeTime),
  capacityPerSlot: f.capacityPerSlot,
  studentDailyLimitMinutes: f.studentDailyLimitMinutes,
  units: f.units.map((u) => ({ id: u.id, name: u.name })),
});

const toData = ({ unitNames: _unitNames, ...input }: FacilityInput) => ({
  ...input,
  openTime: toMinutes(input.openTime),
  closeTime: toEndMinutes(input.closeTime),
});

export async function getOrThrow(id: string) {
  const facility = await facilitiesRepo.findById(id);
  if (!facility) throw notFound('Baza sportivă nu a fost găsită.');
  return facility;
}

export const list = async () => (await facilitiesRepo.list()).map(toFacilityDto);

export const get = async (id: string) => toFacilityDto(await getOrThrow(id));

export const create = async (input: FacilityInput) =>
  toFacilityDto(await facilitiesRepo.create(toData(input), input.unitNames));

/** Units are matched by name: new names are created, missing ones archived (if no upcoming bookings). */
export async function update(id: string, input: FacilityInput) {
  await getOrThrow(id);
  const units = await facilitiesRepo.allUnits(id);
  const byName = new Map(units.map((u) => [u.name, u]));
  const archive = units.filter((u) => !u.archivedAt && !input.unitNames.includes(u.name));
  if (
    archive.length &&
    (await bookingsRepo.countUpcomingActive(
      archive.map((u) => u.id),
      nowLocal(),
    ))
  ) {
    throw conflict(
      'FACILITY_HAS_ACTIVE_BOOKINGS',
      `${archive.map((u) => u.name).join(', ')} are rezervări viitoare active și nu poate fi eliminat.`,
    );
  }
  const updated = await facilitiesRepo.update(id, toData(input), {
    create: input.unitNames.filter((n) => !byName.has(n)),
    restore: input.unitNames.flatMap((n) => (byName.get(n)?.archivedAt ? [byName.get(n)!.id] : [])),
    archive: archive.map((u) => u.id),
  });
  return toFacilityDto(updated);
}

/** Soft delete: past bookings keep referencing the facility. */
export async function remove(id: string) {
  const facility = await getOrThrow(id);
  if (
    await bookingsRepo.countUpcomingActive(
      facility.units.map((u) => u.id),
      nowLocal(),
    )
  ) {
    throw conflict(
      'FACILITY_HAS_ACTIVE_BOOKINGS',
      'Baza are rezervări viitoare active și nu poate fi ștearsă.',
    );
  }
  await facilitiesRepo.archive(id);
}

export async function listSlots(user: User, facilityId: string, date: string, unitId?: string) {
  const facility = await getOrThrow(facilityId);
  const units = unitId ? facility.units.filter((u) => u.id === unitId) : facility.units;
  if (!units.length) throw notFound('Terenul nu a fost găsit.');

  const now = nowLocal();
  const tooFar = daysBetween(now.date, date) > config.maxDaysAhead;
  const bookings = await bookingsRepo.activeOnDate(
    units.map((u) => u.id),
    date,
  );
  const blocks = await maintenanceRepo.overlapping(
    facility.id,
    unitId,
    toInstant(date, facility.openTime),
    toInstant(date, facility.closeTime),
  );

  return units.flatMap((unit) => {
    const slots = [];
    for (let start = facility.openTime; start < facility.closeTime; start += SLOT) {
      const end = start + SLOT;
      const [from, to] = [toInstant(date, start), toInstant(date, end)];
      const bookedBy = bookings
        .filter((b) => b.unitId === unit.id && b.startTime < end && b.endTime > start)
        .map((b) => toUserSummary(b.user));
      const status =
        date < now.date || (date === now.date && start < now.minutes)
          ? 'PAST'
          : blocks.some(
                (m) => (!m.unitId || m.unitId === unit.id) && m.startsAt < to && m.endsAt > from,
              )
            ? 'MAINTENANCE'
            : bookedBy.length >= facility.capacityPerSlot
              ? 'FULL'
              : tooFar || (user.role === 'STUDENT' && start < STUDENT_EARLIEST_START)
                ? 'RESTRICTED'
                : 'FREE';
      slots.push({
        unitId: unit.id,
        startTime: toHHMM(start),
        endTime: toHHMM(end),
        capacity: facility.capacityPerSlot,
        booked: bookedBy.length,
        status,
        bookedBy,
      });
    }
    return slots;
  });
}
