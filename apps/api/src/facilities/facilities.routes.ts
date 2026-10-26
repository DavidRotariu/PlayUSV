import { Router } from 'express';
import { z } from 'zod';
import * as s from '../lib/schemas';
import { toEndMinutes, toMinutes } from '../lib/time';
import { requireAdmin } from '../middleware/auth';
import * as facilitiesService from './facilities.service';

export const facilitiesRouter = Router();

const facilityInput = z
  .object({
    name: z.string().trim().min(1),
    type: z.enum(['POOL', 'GYM', 'FOOTBALL', 'BASKETBALL']),
    openTime: s.time,
    closeTime: s.time,
    capacityPerSlot: z.int().min(1),
    studentDailyLimitMinutes: z.int().min(30).multipleOf(30),
    unitNames: z.array(z.string().trim().min(1)).min(1),
  })
  .refine((f) => toEndMinutes(f.closeTime) > toMinutes(f.openTime), {
    message: 'Ora de închidere trebuie să fie după ora de deschidere.',
  })
  .refine((f) => new Set(f.unitNames).size === f.unitNames.length, {
    message: 'Numele unităților trebuie să fie diferite.',
  });

const facilityId = (params: unknown) => z.object({ facilityId: s.uuid }).parse(params).facilityId;

facilitiesRouter.get('/', async (_req, res) => {
  res.json(await facilitiesService.list());
});

facilitiesRouter.post('/', requireAdmin, async (req, res) => {
  res.status(201).json(await facilitiesService.create(facilityInput.parse(req.body)));
});

facilitiesRouter.get('/:facilityId', async (req, res) => {
  res.json(await facilitiesService.get(facilityId(req.params)));
});

facilitiesRouter.put('/:facilityId', requireAdmin, async (req, res) => {
  res.json(await facilitiesService.update(facilityId(req.params), facilityInput.parse(req.body)));
});

facilitiesRouter.delete('/:facilityId', requireAdmin, async (req, res) => {
  await facilitiesService.remove(facilityId(req.params));
  res.status(204).end();
});

facilitiesRouter.get('/:facilityId/slots', async (req, res) => {
  const q = z.object({ date: s.date, unitId: s.uuid.optional() }).parse(req.query);
  res.json(await facilitiesService.listSlots(req.user, facilityId(req.params), q.date, q.unitId));
});
