import { describe, expect, it } from 'vitest';
import { type BookingCheck, checkBookingRules } from '../../src/bookings/bookings.rules';
import { toEndMinutes, toHHMM, toInstant, toMinutes as m } from '../../src/lib/time';

const pool = {
  name: 'Bazin de înot',
  openTime: m('08:00'),
  closeTime: m('22:00'),
  capacityPerSlot: 10,
  studentDailyLimitMinutes: 60,
};
const gym = {
  ...pool,
  name: 'Sală de fitness',
  closeTime: 1440,
  capacityPerSlot: 50,
  studentDailyLimitMinutes: 120,
};

const base: BookingCheck = {
  role: 'STUDENT',
  facility: pool,
  date: '2026-10-27',
  start: m('18:00'),
  end: m('18:30'),
  now: { date: '2026-10-26', minutes: m('12:00') },
  maxDaysAhead: 14,
  userBookings: [],
  unitBookings: [],
  inMaintenance: false,
};

const codeOf = (overrides: Partial<BookingCheck>) => {
  try {
    checkBookingRules({ ...base, ...overrides });
    return 'OK';
  } catch (e) {
    return (e as { code: string }).code;
  }
};

const range = (start: string, end: string) => ({ startTime: m(start), endTime: toEndMinutes(end) });

describe('checkBookingRules', () => {
  it('accepts a valid student booking', () => {
    expect(codeOf({})).toBe('OK');
  });

  it('rejects end before start and off-grid times', () => {
    expect(codeOf({ start: m('19:00'), end: m('18:30') })).toBe('VALIDATION_ERROR');
    expect(codeOf({ start: m('18:15'), end: m('18:45') })).toBe('VALIDATION_ERROR');
  });

  it('OUTSIDE_OPENING_HOURS', () => {
    expect(codeOf({ start: m('21:30'), end: m('22:30') })).toBe('OUTSIDE_OPENING_HOURS');
    expect(codeOf({ role: 'TEACHER', start: m('07:30'), end: m('08:30') })).toBe(
      'OUTSIDE_OPENING_HOURS',
    );
    expect(codeOf({ start: m('21:30'), end: m('22:00') })).toBe('OK');
  });

  it('midnight close: 23:30–00:00 is bookable at the gym, not past midnight', () => {
    expect(codeOf({ facility: gym, start: m('23:30'), end: 1440 })).toBe('OK');
    expect(codeOf({ facility: gym, start: m('22:00'), end: 1440 })).toBe('OK');
    expect(codeOf({ start: m('21:30'), end: 1440 })).toBe('OUTSIDE_OPENING_HOURS');
  });

  it('BOOKING_IN_PAST', () => {
    expect(codeOf({ date: '2026-10-25' })).toBe('BOOKING_IN_PAST');
    const now = { date: '2026-10-27', minutes: m('18:10') };
    expect(codeOf({ now })).toBe('BOOKING_IN_PAST');
    expect(codeOf({ now, start: m('18:30'), end: m('19:00') })).toBe('OK');
  });

  it('BOOKING_TOO_FAR_AHEAD at 14 days', () => {
    expect(codeOf({ date: '2026-11-09' })).toBe('OK');
    expect(codeOf({ date: '2026-11-10' })).toBe('BOOKING_TOO_FAR_AHEAD');
  });

  it('STUDENT_TIME_RESTRICTED: boundary at 18:00, students only', () => {
    expect(codeOf({ start: m('17:30'), end: m('18:00') })).toBe('STUDENT_TIME_RESTRICTED');
    expect(codeOf({ start: m('17:30'), end: m('18:30') })).toBe('STUDENT_TIME_RESTRICTED');
    expect(codeOf({ start: m('18:00'), end: m('18:30') })).toBe('OK');
    expect(codeOf({ role: 'TEACHER', start: m('08:00'), end: m('08:30') })).toBe('OK');
    expect(codeOf({ role: 'ADMIN', start: m('08:00'), end: m('08:30') })).toBe('OK');
  });

  it('DAILY_LIMIT_EXCEEDED: exactly the limit is allowed, 30 minutes more is not', () => {
    expect(codeOf({ start: m('18:00'), end: m('19:00') })).toBe('OK');
    expect(codeOf({ start: m('18:00'), end: m('19:30') })).toBe('DAILY_LIMIT_EXCEEDED');
    const userBookings = [range('20:00', '20:30')];
    expect(codeOf({ userBookings, start: m('18:00'), end: m('18:30') })).toBe('OK');
    expect(codeOf({ userBookings, start: m('18:00'), end: m('19:00') })).toBe(
      'DAILY_LIMIT_EXCEEDED',
    );
    expect(codeOf({ role: 'TEACHER', start: m('08:00'), end: m('22:00') })).toBe('OK');
  });

  it('ALREADY_BOOKED when the user overlaps their own booking', () => {
    expect(codeOf({ userBookings: [range('18:00', '18:30')] })).toBe('ALREADY_BOOKED');
    expect(
      codeOf({
        role: 'TEACHER',
        userBookings: [range('17:00', '19:00')],
        start: m('18:30'),
        end: m('19:30'),
      }),
    ).toBe('ALREADY_BOOKED');
  });

  it('CAPACITY_EXCEEDED on any slot of the range', () => {
    const nine = Array.from({ length: 9 }, () => range('18:30', '19:00'));
    expect(codeOf({ unitBookings: nine, end: m('19:00') })).toBe('OK');
    expect(codeOf({ unitBookings: [...nine, range('18:00', '19:00')], end: m('19:00') })).toBe(
      'CAPACITY_EXCEEDED',
    );
    expect(
      codeOf({
        facility: { ...pool, capacityPerSlot: 1 },
        unitBookings: [range('18:00', '18:30')],
      }),
    ).toBe('CAPACITY_EXCEEDED');
  });

  it('FACILITY_IN_MAINTENANCE', () => {
    expect(codeOf({ inMaintenance: true })).toBe('FACILITY_IN_MAINTENANCE');
  });

  it('reports rules in order', () => {
    // Student before 18:00 over the limit on a full slot in maintenance: the time rule wins.
    const full = Array.from({ length: 10 }, () => range('17:00', '17:30'));
    expect(
      codeOf({ start: m('17:00'), end: m('19:00'), unitBookings: full, inMaintenance: true }),
    ).toBe('STUDENT_TIME_RESTRICTED');
    expect(codeOf({ end: m('19:30'), unitBookings: full, inMaintenance: true })).toBe(
      'DAILY_LIMIT_EXCEEDED',
    );
    const fullAt18 = Array.from({ length: 10 }, () => range('18:00', '18:30'));
    expect(codeOf({ unitBookings: fullAt18, inMaintenance: true })).toBe('CAPACITY_EXCEEDED');
  });
});

describe('time helpers', () => {
  it('handles midnight as an end time', () => {
    expect(toEndMinutes('00:00')).toBe(1440);
    expect(toHHMM(1440)).toBe('00:00');
    expect(toHHMM(m('18:30'))).toBe('18:30');
  });

  it('converts Bucharest wall clock to instants across DST', () => {
    expect(toInstant('2026-10-27', m('18:00')).toISOString()).toBe('2026-10-27T16:00:00.000Z');
    expect(toInstant('2026-07-01', m('18:00')).toISOString()).toBe('2026-07-01T15:00:00.000Z');
    expect(toInstant('2026-10-27', 1440).toISOString()).toBe('2026-10-27T22:00:00.000Z');
  });
});
