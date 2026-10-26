import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/app';
import { dbDate } from '../../src/lib/time';
import { bearer, createFacility, createUser, inDays, prisma, resetDb } from '../helpers';

beforeEach(resetDb);

const book = (token: string, body: object) =>
  request(app).post('/api/bookings').set('Authorization', token).send(body);

describe('slots', () => {
  it('lists every 30-minute slot with status and booker names only', async () => {
    const pool = await createFacility({ capacityPerSlot: 2 });
    const unitId = pool.units[0].id;
    const student = await createUser('STUDENT');
    const others = [await createUser('STUDENT', { name: 'Ana Pop' }), await createUser('STUDENT')];
    const date = inDays(1);
    for (const o of others) {
      await prisma.booking.create({
        data: { userId: o.id, unitId, date: dbDate(date), startTime: 1080, endTime: 1110 },
      });
    }

    const res = await request(app)
      .get(`/api/facilities/${pool.id}/slots?date=${date}`)
      .set('Authorization', bearer(student));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(28); // 08:00–22:00
    const at = (t: string) => res.body.find((s: { startTime: string }) => s.startTime === t);
    expect(at('17:30')).toMatchObject({ status: 'RESTRICTED', booked: 0, capacity: 2 });
    expect(at('18:00')).toMatchObject({ status: 'FULL', booked: 2, endTime: '18:30' });
    expect(at('18:00').bookedBy[0]).toEqual({ id: others[0].id, name: 'Ana Pop' });
    expect(at('18:30').status).toBe('FREE');

    const teacher = await createUser('TEACHER');
    const t = await request(app)
      .get(`/api/facilities/${pool.id}/slots?date=${date}`)
      .set('Authorization', bearer(teacher));
    expect(t.body[0]).toMatchObject({ startTime: '08:00', status: 'FREE' });

    const past = await request(app)
      .get(`/api/facilities/${pool.id}/slots?date=${inDays(-1)}`)
      .set('Authorization', bearer(teacher));
    expect(past.body.every((s: { status: string }) => s.status === 'PAST')).toBe(true);
  });

  it('returns slots for each unit, ending at midnight when closeTime is 00:00', async () => {
    const courts = await createFacility({ closeTime: 1440 }, ['Terenul 1', 'Terenul 2']);
    const user = await createUser('TEACHER');
    const res = await request(app)
      .get(`/api/facilities/${courts.id}/slots?date=${inDays(1)}`)
      .set('Authorization', bearer(user));
    expect(res.body).toHaveLength(64);
    expect(res.body[31]).toMatchObject({
      unitId: courts.units[0].id,
      startTime: '23:30',
      endTime: '00:00',
    });

    const one = await request(app)
      .get(`/api/facilities/${courts.id}/slots?date=${inDays(1)}&unitId=${courts.units[1].id}`)
      .set('Authorization', bearer(user));
    expect(one.body).toHaveLength(32);
  });
});

describe('POST /bookings', () => {
  it('creates a booking and returns the spec shape', async () => {
    const pool = await createFacility();
    const student = await createUser('STUDENT');
    const date = inDays(1);
    const res = await book(bearer(student), {
      unitId: pool.units[0].id,
      date,
      startTime: '18:00',
      endTime: '19:00',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      user: { id: student.id, name: student.name },
      facilityId: pool.id,
      facilityName: 'Bazin de înot',
      unitId: pool.units[0].id,
      unitName: 'Bazinul',
      date,
      startTime: '18:00',
      endTime: '19:00',
      status: 'ACTIVE',
      cancelledBy: null,
    });
    expect(res.body.user).not.toHaveProperty('email');
  });

  it('returns the rule error codes', async () => {
    const pool = await createFacility({ capacityPerSlot: 1 });
    const unitId = pool.units[0].id;
    const [s1, s2] = [await createUser('STUDENT'), await createUser('STUDENT')];
    const date = inDays(1);
    const expectCode = async (token: string, body: object, status: number, code: string) => {
      const res = await book(token, { unitId, date, ...body });
      expect(res.status).toBe(status);
      expect(res.body.code).toBe(code);
      expect(typeof res.body.message).toBe('string');
    };

    await expectCode(bearer(s1), { startTime: '19:00', endTime: '18:30' }, 400, 'VALIDATION_ERROR');
    await expectCode(bearer(s1), { startTime: '18:15', endTime: '18:45' }, 400, 'VALIDATION_ERROR');
    await expectCode(
      bearer(s1),
      { startTime: '21:30', endTime: '22:30' },
      409,
      'OUTSIDE_OPENING_HOURS',
    );
    await expectCode(
      bearer(s1),
      { date: inDays(-1), startTime: '18:00', endTime: '18:30' },
      409,
      'BOOKING_IN_PAST',
    );
    await expectCode(
      bearer(s1),
      { date: inDays(15), startTime: '18:00', endTime: '18:30' },
      409,
      'BOOKING_TOO_FAR_AHEAD',
    );
    await expectCode(
      bearer(s1),
      { startTime: '17:30', endTime: '18:00' },
      409,
      'STUDENT_TIME_RESTRICTED',
    );
    await expectCode(
      bearer(s1),
      { startTime: '18:00', endTime: '19:30' },
      409,
      'DAILY_LIMIT_EXCEEDED',
    );
    expect(
      (await book(bearer(s1), { unitId, date, startTime: '18:00', endTime: '18:30' })).status,
    ).toBe(201);
    await expectCode(bearer(s1), { startTime: '18:00', endTime: '18:30' }, 409, 'ALREADY_BOOKED');
    await expectCode(
      bearer(s2),
      { startTime: '18:00', endTime: '18:30' },
      409,
      'CAPACITY_EXCEEDED',
    );
    await expectCode(
      bearer(s2),
      { unitId: '00000000-0000-4000-8000-000000000000', startTime: '18:00', endTime: '18:30' },
      404,
      'NOT_FOUND',
    );
  });

  it('only admins may book on behalf of someone, with the target user’s rules', async () => {
    const pool = await createFacility();
    const unitId = pool.units[0].id;
    const [admin, student, other] = [
      await createUser('ADMIN'),
      await createUser('STUDENT'),
      await createUser('STUDENT'),
    ];
    const date = inDays(1);

    const denied = await book(bearer(student), {
      unitId,
      date,
      startTime: '18:00',
      endTime: '18:30',
      userId: other.id,
    });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('FORBIDDEN');

    const restricted = await book(bearer(admin), {
      unitId,
      date,
      startTime: '10:00',
      endTime: '10:30',
      userId: other.id,
    });
    expect(restricted.body.code).toBe('STUDENT_TIME_RESTRICTED');

    const ok = await book(bearer(admin), {
      unitId,
      date,
      startTime: '18:00',
      endTime: '18:30',
      userId: other.id,
    });
    expect(ok.status).toBe(201);
    expect(ok.body.user.id).toBe(other.id);
  });

  it('allows teachers any time and any length', async () => {
    const gym = await createFacility({ closeTime: 1440, studentDailyLimitMinutes: 120 });
    const teacher = await createUser('TEACHER');
    const res = await book(bearer(teacher), {
      unitId: gym.units[0].id,
      date: inDays(1),
      startTime: '08:00',
      endTime: '00:00',
    });
    expect(res.status).toBe(201);
    expect(res.body.endTime).toBe('00:00');
  });
});

describe('reading and cancelling', () => {
  it('derives COMPLETED for ended ACTIVE bookings', async () => {
    const pool = await createFacility();
    const student = await createUser('STUDENT');
    const admin = await createUser('ADMIN');
    const b = await prisma.booking.create({
      data: {
        userId: student.id,
        unitId: pool.units[0].id,
        date: dbDate(inDays(-1)),
        startTime: 1080,
        endTime: 1110,
      },
    });

    const past = await request(app)
      .get('/api/bookings/me?scope=past')
      .set('Authorization', bearer(student));
    expect(past.body).toHaveLength(1);
    expect(past.body[0]).toMatchObject({ id: b.id, status: 'COMPLETED' });
    const upcoming = await request(app)
      .get('/api/bookings/me')
      .set('Authorization', bearer(student));
    expect(upcoming.body).toHaveLength(0);

    const completed = await request(app)
      .get('/api/bookings?status=COMPLETED')
      .set('Authorization', bearer(admin));
    expect(completed.body.map((x: { id: string }) => x.id)).toEqual([b.id]);
    const active = await request(app)
      .get('/api/bookings?status=ACTIVE')
      .set('Authorization', bearer(admin));
    expect(active.body).toHaveLength(0);

    const cancel = await request(app)
      .post(`/api/bookings/${b.id}/cancel`)
      .set('Authorization', bearer(admin));
    expect(cancel.status).toBe(409);
    expect(cancel.body.code).toBe('BOOKING_NOT_CANCELLABLE');
  });

  it('lets users cancel their own upcoming bookings and admins cancel any', async () => {
    const pool = await createFacility();
    const unitId = pool.units[0].id;
    const [owner, other, admin] = [
      await createUser('STUDENT'),
      await createUser('STUDENT'),
      await createUser('ADMIN'),
    ];
    const mk = () =>
      prisma.booking.create({
        data: { userId: owner.id, unitId, date: dbDate(inDays(1)), startTime: 1080, endTime: 1110 },
      });

    const b1 = await mk();
    expect(
      (await request(app).get(`/api/bookings/${b1.id}`).set('Authorization', bearer(other))).status,
    ).toBe(403);
    const denied = await request(app)
      .post(`/api/bookings/${b1.id}/cancel`)
      .set('Authorization', bearer(other));
    expect(denied.status).toBe(403);

    const own = await request(app)
      .post(`/api/bookings/${b1.id}/cancel`)
      .set('Authorization', bearer(owner));
    expect(own.status).toBe(200);
    expect(own.body).toMatchObject({ status: 'CANCELLED', cancelledBy: 'USER' });
    const again = await request(app)
      .post(`/api/bookings/${b1.id}/cancel`)
      .set('Authorization', bearer(owner));
    expect(again.body.code).toBe('BOOKING_NOT_CANCELLABLE');

    const b2 = await mk();
    const byAdmin = await request(app)
      .post(`/api/bookings/${b2.id}/cancel`)
      .set('Authorization', bearer(admin));
    expect(byAdmin.body).toMatchObject({ status: 'CANCELLED', cancelledBy: 'ADMIN' });

    expect(await prisma.booking.count()).toBe(2); // never deleted
  });

  it('does not let users cancel a booking that has started; admins still can', async () => {
    const gym = await createFacility({ openTime: 0, closeTime: 1440 });
    const [teacher, admin] = [await createUser('TEACHER'), await createUser('ADMIN')];
    // All of today: started, not ended.
    const started = await prisma.booking.create({
      data: {
        userId: teacher.id,
        unitId: gym.units[0].id,
        date: dbDate(inDays(0)),
        startTime: 0,
        endTime: 1440,
      },
    });
    const res = await request(app)
      .post(`/api/bookings/${started.id}/cancel`)
      .set('Authorization', bearer(teacher));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('BOOKING_NOT_CANCELLABLE');
    const byAdmin = await request(app)
      .post(`/api/bookings/${started.id}/cancel`)
      .set('Authorization', bearer(admin));
    expect(byAdmin.body).toMatchObject({ status: 'CANCELLED', cancelledBy: 'ADMIN' });
  });
});
