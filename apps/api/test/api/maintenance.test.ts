import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/app';
import { dbDate, toInstant } from '../../src/lib/time';
import { bearer, createFacility, createUser, inDays, prisma, resetDb } from '../helpers';

beforeEach(resetDb);

describe('maintenance', () => {
  it('previews, then cancels overlapping bookings in the same request', async () => {
    const courts = await createFacility({ capacityPerSlot: 1 }, ['Terenul 1', 'Terenul 2']);
    const [t1, t2] = courts.units.map((u) => u.id);
    const [admin, student] = [await createUser('ADMIN'), await createUser('STUDENT')];
    const date = inDays(1);
    const mk = (unitId: string, startTime: number, endTime: number) =>
      prisma.booking.create({
        data: { userId: student.id, unitId, date: dbDate(date), startTime, endTime },
      });
    const inside = await mk(t1, 1080, 1140); // 18:00–19:00, overlaps 18:30–20:00
    const after = await mk(t1, 1200, 1230); // 20:00–20:30, untouched
    const otherCourt = await mk(t2, 1080, 1140);

    const range = {
      startsAt: toInstant(date, 1110).toISOString(),
      endsAt: toInstant(date, 1200).toISOString(),
    };
    const auth = bearer(admin);

    const preview = await request(app)
      .get(`/api/facilities/${courts.id}/maintenance/preview`)
      .query({ ...range, unitId: t1 })
      .set('Authorization', auth);
    expect(preview.status).toBe(200);
    expect(preview.body.map((b: { id: string }) => b.id)).toEqual([inside.id]);
    expect((await prisma.booking.findUnique({ where: { id: inside.id } }))!.status).toBe('ACTIVE');

    const created = await request(app)
      .post(`/api/facilities/${courts.id}/maintenance`)
      .set('Authorization', auth)
      .send({ ...range, unitId: t1, reason: 'Reparație coș' });
    expect(created.status).toBe(201);
    expect(created.body.block).toMatchObject({
      facilityId: courts.id,
      unitId: t1,
      reason: 'Reparație coș',
      createdBy: { id: admin.id, name: admin.name },
    });
    expect(created.body.cancelledBookings).toHaveLength(1);
    expect(created.body.cancelledBookings[0]).toMatchObject({
      id: inside.id,
      status: 'CANCELLED',
      cancelledBy: 'MAINTENANCE',
    });

    const statuses = await prisma.booking.findMany({ select: { id: true, status: true } });
    expect(Object.fromEntries(statuses.map((b) => [b.id, b.status]))).toEqual({
      [inside.id]: 'CANCELLED',
      [after.id]: 'ACTIVE',
      [otherCourt.id]: 'ACTIVE',
    });

    // Slots and new bookings respect the block.
    const slots = await request(app)
      .get(`/api/facilities/${courts.id}/slots?date=${date}&unitId=${t1}`)
      .set('Authorization', auth);
    const at = (t: string) =>
      slots.body.find((s: { startTime: string }) => s.startTime === t).status;
    expect([at('18:00'), at('18:30'), at('19:30'), at('20:00')]).toEqual([
      'FREE',
      'MAINTENANCE',
      'MAINTENANCE',
      'FULL',
    ]);
    const blocked = await request(app)
      .post('/api/bookings')
      .set('Authorization', bearer(await createUser('STUDENT')))
      .send({ unitId: t1, date, startTime: '19:00', endTime: '19:30' });
    expect(blocked.body.code).toBe('FACILITY_IN_MAINTENANCE');

    // Whole-facility block overlapping a unit block.
    const overlap = await request(app)
      .post(`/api/facilities/${courts.id}/maintenance`)
      .set('Authorization', auth)
      .send(range);
    expect(overlap.status).toBe(409);
    expect(overlap.body.code).toBe('MAINTENANCE_OVERLAP');

    // Deleting does not restore the cancelled booking.
    const del = await request(app)
      .delete(`/api/maintenance/${created.body.block.id}`)
      .set('Authorization', auth);
    expect(del.status).toBe(204);
    expect((await prisma.booking.findUnique({ where: { id: inside.id } }))!.status).toBe(
      'CANCELLED',
    );
    const list = await request(app)
      .get(`/api/facilities/${courts.id}/maintenance`)
      .set('Authorization', bearer(student));
    expect(list.body).toEqual([]);
  });

  it('is admin only and validates the range', async () => {
    const pool = await createFacility();
    const [admin, student] = [await createUser('ADMIN'), await createUser('STUDENT')];
    const date = inDays(1);
    const body = {
      startsAt: toInstant(date, 600).toISOString(),
      endsAt: toInstant(date, 660).toISOString(),
    };

    const denied = await request(app)
      .post(`/api/facilities/${pool.id}/maintenance`)
      .set('Authorization', bearer(student))
      .send(body);
    expect(denied.status).toBe(403);

    const reversed = await request(app)
      .post(`/api/facilities/${pool.id}/maintenance`)
      .set('Authorization', bearer(admin))
      .send({ startsAt: body.endsAt, endsAt: body.startsAt });
    expect(reversed.status).toBe(400);
    expect(reversed.body.code).toBe('VALIDATION_ERROR');

    const missing = await request(app)
      .delete('/api/maintenance/00000000-0000-4000-8000-000000000000')
      .set('Authorization', bearer(admin));
    expect(missing.status).toBe(404);
  });
});
