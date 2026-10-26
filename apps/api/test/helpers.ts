import type { Role, User } from '@prisma/client';
import { signToken } from '../src/auth/auth.service';
import { prisma } from '../src/lib/prisma';
import { addDays, nowLocal } from '../src/lib/time';

export { prisma };

export const resetDb = () =>
  prisma.$executeRawUnsafe(
    'TRUNCATE "Booking", "MaintenanceBlock", "FacilityUnit", "Facility", "User" CASCADE',
  );

let n = 0;
export function createUser(role: Role, overrides: Partial<User> = {}) {
  n++;
  const domain = role === 'STUDENT' ? 'student.usv.ro' : 'usm.ro';
  return prisma.user.create({
    data: {
      name: `${role} ${n}`,
      email: `${role.toLowerCase()}${n}@${domain}`,
      role,
      ...overrides,
    },
  });
}

/** Defaults look like the pool: 08:00–22:00, 10 per slot, 60 min/day for students. */
export function createFacility(
  overrides: Partial<{
    name: string;
    openTime: number;
    closeTime: number;
    capacityPerSlot: number;
    studentDailyLimitMinutes: number;
  }> = {},
  unitNames = ['Bazinul'],
) {
  return prisma.facility.create({
    data: {
      name: 'Bazin de înot',
      type: 'POOL',
      openTime: 480,
      closeTime: 1320,
      capacityPerSlot: 10,
      studentDailyLimitMinutes: 60,
      ...overrides,
      units: { create: unitNames.map((name) => ({ name })) },
    },
    include: { units: { orderBy: { name: 'asc' } } },
  });
}

export const bearer = (user: User) => `Bearer ${signToken(user)}`;

export const inDays = (days: number) => addDays(nowLocal().date, days);
