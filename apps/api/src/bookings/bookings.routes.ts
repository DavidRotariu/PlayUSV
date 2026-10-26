import { Router } from 'express';
import { z } from 'zod';
import * as s from '../lib/schemas';
import { toEndMinutes, toMinutes } from '../lib/time';
import { requireAdmin } from '../middleware/auth';
import * as bookingsService from './bookings.service';

export const bookingsRouter = Router();

const bookingCreate = z
  .object({
    unitId: s.uuid,
    date: s.date,
    startTime: s.time,
    endTime: s.time,
    userId: s.uuid.optional(),
  })
  .refine((b) => toEndMinutes(b.endTime) > toMinutes(b.startTime), {
    message: 'Ora de sfârșit trebuie să fie după ora de început.',
  });

const bookingId = (params: unknown) => z.object({ bookingId: s.uuid }).parse(params).bookingId;

bookingsRouter.post('/', async (req, res) => {
  res.status(201).json(await bookingsService.create(req.user, bookingCreate.parse(req.body)));
});

bookingsRouter.get('/', requireAdmin, async (req, res) => {
  const q = z
    .object({
      facilityId: s.uuid.optional(),
      date: s.date.optional(),
      userId: s.uuid.optional(),
      status: z.enum(['ACTIVE', 'CANCELLED', 'COMPLETED']).optional(),
    })
    .parse(req.query);
  res.json(await bookingsService.list(q));
});

bookingsRouter.get('/me', async (req, res) => {
  const { scope } = z
    .object({ scope: z.enum(['upcoming', 'past']).default('upcoming') })
    .parse(req.query);
  res.json(await bookingsService.listMine(req.user, scope));
});

bookingsRouter.get('/:bookingId', async (req, res) => {
  res.json(await bookingsService.get(req.user, bookingId(req.params)));
});

bookingsRouter.post('/:bookingId/cancel', async (req, res) => {
  res.json(await bookingsService.cancel(req.user, bookingId(req.params)));
});
