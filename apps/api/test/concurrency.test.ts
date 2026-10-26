import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { dbDate } from '../src/lib/time';
import { bearer, createFacility, createUser, inDays, prisma, resetDb } from './helpers';

beforeEach(resetDb);

describe('concurrent bookings', () => {
  it('only one of many simultaneous requests gets the last spot', async () => {
    const pool = await createFacility({ capacityPerSlot: 10 });
    const unitId = pool.units[0].id;
    const date = inDays(1);
    for (let i = 0; i < 9; i++) {
      const u = await createUser('STUDENT');
      await prisma.booking.create({
        data: { userId: u.id, unitId, date: dbDate(date), startTime: 1080, endTime: 1110 },
      });
    }
    const contenders = await Promise.all(Array.from({ length: 10 }, () => createUser('STUDENT')));

    const results = await Promise.all(
      contenders.map((u) =>
        request(app)
          .post('/api/bookings')
          .set('Authorization', bearer(u))
          .send({ unitId, date, startTime: '18:00', endTime: '18:30' }),
      ),
    );

    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const rejected = results.filter((r) => r.status !== 201);
    expect(rejected).toHaveLength(9);
    expect(rejected.every((r) => r.status === 409 && r.body.code === 'CAPACITY_EXCEEDED')).toBe(
      true,
    );
    expect(await prisma.booking.count({ where: { unitId, status: 'ACTIVE' } })).toBe(10);
  });

  it('a student cannot exceed the daily limit by booking two courts at once', async () => {
    const courts = await createFacility({ capacityPerSlot: 1, studentDailyLimitMinutes: 60 }, [
      'Terenul 1',
      'Terenul 2',
    ]);
    const student = await createUser('STUDENT');
    const date = inDays(1);

    const results = await Promise.all([
      request(app)
        .post('/api/bookings')
        .set('Authorization', bearer(student))
        .send({ unitId: courts.units[0].id, date, startTime: '18:00', endTime: '19:00' }),
      request(app)
        .post('/api/bookings')
        .set('Authorization', bearer(student))
        .send({ unitId: courts.units[1].id, date, startTime: '19:00', endTime: '20:00' }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body.code).toBe('DAILY_LIMIT_EXCEEDED');
  });
});
