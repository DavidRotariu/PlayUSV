import type { Facility, FacilityUnit, Prisma } from '@prisma/client';
import { prisma, type Tx } from '../lib/prisma';

const withUnits = {
  units: { where: { archivedAt: null }, orderBy: { name: 'asc' } },
} satisfies Prisma.FacilityInclude;

export type FacilityWithUnits = Prisma.FacilityGetPayload<{ include: typeof withUnits }>;
export type FacilityData = Omit<Prisma.FacilityCreateInput, 'units' | 'maintenance' | 'archivedAt'>;

export const list = () =>
  prisma.facility.findMany({
    where: { archivedAt: null },
    include: withUnits,
    orderBy: { name: 'asc' },
  });

export const findById = (id: string) =>
  prisma.facility.findFirst({ where: { id, archivedAt: null }, include: withUnits });

export const create = (data: FacilityData, unitNames: string[]) =>
  prisma.facility.create({
    data: { ...data, units: { create: unitNames.map((name) => ({ name })) } },
    include: withUnits,
  });

/** All units ever created for the facility, archived ones included. */
export const allUnits = (facilityId: string) =>
  prisma.facilityUnit.findMany({ where: { facilityId } });

export const update = (
  id: string,
  data: FacilityData,
  units: { create: string[]; restore: string[]; archive: string[] },
) =>
  prisma.$transaction(async (tx) => {
    await tx.facilityUnit.createMany({
      data: units.create.map((name) => ({ facilityId: id, name })),
    });
    await tx.facilityUnit.updateMany({
      where: { id: { in: units.restore } },
      data: { archivedAt: null },
    });
    await tx.facilityUnit.updateMany({
      where: { id: { in: units.archive } },
      data: { archivedAt: new Date() },
    });
    return tx.facility.update({ where: { id }, data, include: withUnits });
  });

export const archive = (id: string) =>
  prisma.facility.update({ where: { id }, data: { archivedAt: new Date() } });

/** Locks the unit row: bookings for one unit run one at a time (capacity check). */
export async function lockUnit(
  tx: Tx,
  unitId: string,
): Promise<(FacilityUnit & { facility: Facility }) | null> {
  const [unit] = await tx.$queryRaw<FacilityUnit[]>`
    SELECT * FROM "FacilityUnit" WHERE id = ${unitId}::uuid AND "archivedAt" IS NULL FOR UPDATE`;
  if (!unit) return null;
  const facility = await tx.facility.findFirst({
    where: { id: unit.facilityId, archivedAt: null },
  });
  return facility && { ...unit, facility };
}

/** Locks every active unit of a facility, in id order, and returns their ids. */
export async function lockUnitsOfFacility(tx: Tx, facilityId: string): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "FacilityUnit"
    WHERE "facilityId" = ${facilityId}::uuid AND "archivedAt" IS NULL
    ORDER BY id FOR UPDATE`;
  return rows.map((r) => r.id);
}
