import type { Facility, Role } from '@prisma/client';
import { conflict, validation } from '../lib/errors';
import { daysBetween, SLOT, toHHMM } from '../lib/time';

export const STUDENT_EARLIEST_START = 18 * 60;

type Range = { startTime: number; endTime: number };

export type BookingCheck = {
  role: Role;
  facility: Pick<Facility, 'name' | 'openTime' | 'closeTime' | 'capacityPerSlot' | 'studentDailyLimitMinutes'>;
  date: string;
  start: number;
  end: number;
  now: { date: string; minutes: number };
  maxDaysAhead: number;
  /** The user's ACTIVE bookings at this facility on `date` (all units). */
  userBookings: Range[];
  /** ACTIVE bookings of the unit on `date`. */
  unitBookings: Range[];
  inMaintenance: boolean;
};

const overlaps = (a: Range, start: number, end: number) => a.startTime < end && a.endTime > start;

/** The booking rules, in the order they are reported. Throws the first one that fails. */
export function checkBookingRules(c: BookingCheck): void {
  const { facility: f, start, end, date, now } = c;

  // 1. Consecutive 30-minute slots, inside opening hours, not in the past, not too far ahead.
  if (end <= start || start % SLOT || end % SLOT) {
    throw validation('Ora de sfârșit trebuie să fie după ora de început.');
  }
  if (start < f.openTime || end > f.closeTime) {
    throw conflict('OUTSIDE_OPENING_HOURS', 'Intervalul ales este în afara programului bazei.');
  }
  if (date < now.date || (date === now.date && start < now.minutes)) {
    throw conflict('BOOKING_IN_PAST', 'Intervalul ales a trecut deja.');
  }
  if (daysBetween(now.date, date) > c.maxDaysAhead) {
    throw conflict(
      'BOOKING_TOO_FAR_AHEAD',
      `Poți rezerva cu cel mult ${c.maxDaysAhead} zile în avans.`,
    );
  }

  const student = c.role === 'STUDENT';

  // 2. Students only from 18:00.
  if (student && start < STUDENT_EARLIEST_START) {
    throw conflict('STUDENT_TIME_RESTRICTED', 'Studenții pot rezerva doar intervale de la 18:00.');
  }

  // 3. Students' daily limit per facility.
  const booked = c.userBookings.reduce((sum, b) => sum + b.endTime - b.startTime, 0);
  if (student && booked + end - start > f.studentDailyLimitMinutes) {
    throw conflict(
      'DAILY_LIMIT_EXCEEDED',
      `Ai atins limita de ${f.studentDailyLimitMinutes} de minute pe zi la ${f.name}.`,
    );
  }

  // The same user can't hold two overlapping bookings at one facility.
  if (c.userBookings.some((b) => overlaps(b, start, end))) {
    throw conflict('ALREADY_BOOKED', 'Ai deja o rezervare la această bază în intervalul ales.');
  }

  // 4. Capacity of every slot in the range.
  for (let s = start; s < end; s += SLOT) {
    if (c.unitBookings.filter((b) => overlaps(b, s, s + SLOT)).length >= f.capacityPerSlot) {
      throw conflict(
        'CAPACITY_EXCEEDED',
        `Intervalul ${toHHMM(s)} – ${toHHMM(s + SLOT)} nu mai are locuri libere.`,
      );
    }
  }

  // 5. Maintenance.
  if (c.inMaintenance) {
    throw conflict('FACILITY_IN_MAINTENANCE', 'Baza este în mentenanță în intervalul ales.');
  }
}
