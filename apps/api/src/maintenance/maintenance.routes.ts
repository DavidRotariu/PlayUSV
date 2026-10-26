import { Router } from 'express';
import { z } from 'zod';
import * as s from '../lib/schemas';
import { requireAdmin } from '../middleware/auth';
import * as maintenanceService from './maintenance.service';

export const maintenanceRouter = Router();

const range = z
  .object({ unitId: s.uuid.optional(), startsAt: s.dateTime, endsAt: s.dateTime })
  .refine((r) => r.endsAt > r.startsAt, {
    message: 'Sfârșitul mentenanței trebuie să fie după început.',
  });

const facilityId = (params: unknown) => z.object({ facilityId: s.uuid }).parse(params).facilityId;

maintenanceRouter.get('/facilities/:facilityId/maintenance', async (req, res) => {
  res.json(await maintenanceService.list(facilityId(req.params)));
});

maintenanceRouter.post('/facilities/:facilityId/maintenance', requireAdmin, async (req, res) => {
  const body = range.and(z.object({ reason: z.string().trim().min(1).optional() })).parse(req.body);
  res.status(201).json(await maintenanceService.create(req.user, facilityId(req.params), body));
});

maintenanceRouter.get(
  '/facilities/:facilityId/maintenance/preview',
  requireAdmin,
  async (req, res) => {
    res.json(await maintenanceService.preview(facilityId(req.params), range.parse(req.query)));
  },
);

maintenanceRouter.delete('/maintenance/:blockId', requireAdmin, async (req, res) => {
  const { blockId } = z.object({ blockId: s.uuid }).parse(req.params);
  await maintenanceService.remove(blockId);
  res.status(204).end();
});
