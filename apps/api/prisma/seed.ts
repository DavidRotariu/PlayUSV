// Wipes all data and inserts demo facilities, users and bookings relative to today (Europe/Bucharest).
import { PrismaClient, Prisma } from '@prisma/client';
import { addDays, dbDate, nowLocal, toMinutes as m } from '../src/lib/time';

const prisma = new PrismaClient();

const facilities = [
  {
    name: 'Bazin de înot',
    type: 'POOL',
    open: '08:00',
    close: 1320,
    cap: 10,
    limit: 60,
    units: ['Bazinul'],
  },
  {
    name: 'Sală de fitness',
    type: 'GYM',
    open: '08:00',
    close: 1440,
    cap: 50,
    limit: 120,
    units: ['Sala'],
  },
  {
    name: 'Teren de fotbal',
    type: 'FOOTBALL',
    open: '08:00',
    close: 1440,
    cap: 1,
    limit: 180,
    units: ['Terenul'],
  },
  {
    name: 'Teren de baschet',
    type: 'BASKETBALL',
    open: '08:00',
    close: 1320,
    cap: 1,
    limit: 120,
    units: ['Terenul 1', 'Terenul 2'],
  },
] as const;

async function main() {
  await prisma.$transaction([
    prisma.booking.deleteMany(),
    prisma.maintenanceBlock.deleteMany(),
    prisma.facilityUnit.deleteMany(),
    prisma.facility.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  const units: Record<string, string> = {};
  for (const f of facilities) {
    const created = await prisma.facility.create({
      data: {
        name: f.name,
        type: f.type,
        openTime: m(f.open),
        closeTime: f.close,
        capacityPerSlot: f.cap,
        studentDailyLimitMinutes: f.limit,
        units: { create: f.units.map((name) => ({ name })) },
      },
      include: { units: true },
    });
    for (const u of created.units) units[`${f.type}:${u.name}`] = u.id;
  }

  const user = (name: string, email: string, role: 'STUDENT' | 'TEACHER' | 'ADMIN') =>
    prisma.user.create({ data: { name, email, role } });

  const admin = await user('Administrator Baze Sportive', 'admin@usm.ro', 'ADMIN');
  const teachers = [
    await user('Prof. Mihai Ionescu', 'mihai.ionescu@usm.ro', 'TEACHER'),
    await user('Conf. Elena Rusu', 'elena.rusu@usm.ro', 'TEACHER'),
  ];
  const firstNames = [
    'Ana',
    'Andrei',
    'Maria',
    'Ioan',
    'Ioana',
    'Vlad',
    'Elena',
    'Radu',
    'Diana',
    'Paul',
    'Irina',
    'Matei',
  ];
  const students = [];
  for (const [i, first] of firstNames.entries()) {
    students.push(await user(`${first} Popescu`, `student${i + 1}@student.usv.ro`, 'STUDENT'));
  }

  const today = nowLocal().date;
  const d1 = dbDate(addDays(today, 1));
  const d2 = dbDate(addDays(today, 2));
  const pool = units['POOL:Bazinul'];
  const b = (
    userId: string,
    unitId: string,
    date: Date,
    start: string,
    end: number,
    extra: Partial<Prisma.BookingCreateManyInput> = {},
  ): Prisma.BookingCreateManyInput => ({
    userId,
    unitId,
    date,
    startTime: m(start),
    endTime: end,
    ...extra,
  });

  await prisma.booking.createMany({
    data: [
      // Tomorrow 18:00–18:30 at the pool is full: 10 of 10 places.
      ...students.slice(0, 10).map((s) => b(s.id, pool, d1, '18:00', m('18:30'))),
      b(students[10].id, pool, d1, '18:30', m('19:30')),
      b(teachers[0].id, pool, d1, '10:00', m('11:00')),
      b(students[11].id, units['GYM:Sala'], d1, '19:00', m('21:00')),
      b(students[0].id, units['GYM:Sala'], d1, '23:00', 1440),
      b(teachers[1].id, units['FOOTBALL:Terenul'], d2, '20:00', m('21:30')),
      b(students[1].id, units['BASKETBALL:Terenul 1'], d1, '19:00', m('20:00')),
      b(students[2].id, units['BASKETBALL:Terenul 2'], d1, '19:00', m('20:00')),
      b(admin.id, units['BASKETBALL:Terenul 2'], d2, '12:00', m('13:00')),
      // A cancelled booking.
      b(students[3].id, units['BASKETBALL:Terenul 1'], d2, '18:00', m('19:00'), {
        status: 'CANCELLED',
        cancelledBy: 'USER',
      }),
    ],
  });

  console.log(`Seed gata: ${facilities.length} baze, ${2 + students.length + 1} utilizatori.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
