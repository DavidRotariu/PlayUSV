// Wall-clock times are stored as minutes since midnight in Europe/Bucharest.
// 1440 is midnight at the end of the day (written "00:00" as an end/close time).
export const TZ = 'Europe/Bucharest';
export const SLOT = 30;

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** End and close times: "00:00" means midnight at the end of the day. */
export function toEndMinutes(hhmm: string): number {
  return toMinutes(hhmm) || 1440;
}

export function toHHMM(minutes: number): string {
  const m = minutes % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Local date ("YYYY-MM-DD") and minutes since midnight of an instant, in Bucharest. */
export function toLocal(instant: Date): { date: string; minutes: number } {
  const p = Object.fromEntries(fmt.formatToParts(instant).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

export const nowLocal = () => toLocal(new Date());

/** The instant of a Bucharest wall-clock time. */
export function toInstant(date: string, minutes: number): Date {
  const guess = Date.parse(`${date}T00:00:00Z`) + minutes * 60_000;
  // Offset of Bucharest at `instant`, in ms (local wall clock minus UTC).
  const offset = (instant: number) => {
    const l = toLocal(new Date(instant));
    return Date.parse(`${l.date}T00:00:00Z`) + l.minutes * 60_000 - instant;
  };
  const first = guess - offset(guess);
  return new Date(guess - offset(first));
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Days from `from` to `to`, both "YYYY-MM-DD". */
export function daysBetween(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
}

/** Prisma maps @db.Date columns to a Date at UTC midnight. */
export const dbDate = (date: string) => new Date(`${date}T00:00:00Z`);
export const fromDbDate = (d: Date) => d.toISOString().slice(0, 10);

export function hasEnded(date: string, end: number, now = nowLocal()): boolean {
  return date < now.date || (date === now.date && end <= now.minutes);
}
