import type { Prisma } from '@prisma/client';
import { prisma, type Tx } from '../lib/prisma';

const details = { createdBy: { select: { id: true, name: true } } } satisfies Prisma.MaintenanceBlockInclude;

export type BlockWithDetails = Prisma.MaintenanceBlockGetPayload<{ include: typeof details }>;

/**
 * Blocks of the facility that overlap [from, to) and touch the unit:
 * whole-facility blocks always do; with no unitId, every block of the facility does.
 */
export const overlapping = (
  facilityId: string,
  unitId: string | null | undefined,
  from: Date,
  to: Date,
  db: Tx = prisma,
) =>
  db.maintenanceBlock.findMany({
    where: {
      facilityId,
      startsAt: { lt: to },
      endsAt: { gt: from },
      ...(unitId && { OR: [{ unitId: null }, { unitId }] }),
    },
  });

export const listForFacility = (facilityId: string) =>
  prisma.maintenanceBlock.findMany({ where: { facilityId }, include: details, orderBy: { startsAt: 'asc' } });

export const create = (data: Prisma.MaintenanceBlockUncheckedCreateInput, tx: Tx) =>
  tx.maintenanceBlock.create({ data, include: details });

export const findById = (id: string) => prisma.maintenanceBlock.findUnique({ where: { id } });

export const remove = (id: string) => prisma.maintenanceBlock.delete({ where: { id } });
