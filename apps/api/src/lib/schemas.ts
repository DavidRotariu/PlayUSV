import { z } from 'zod';

export const time = z.string().regex(/^([01][0-9]|2[0-3]):(00|30)$/);
export const date = z.iso.date();
export const uuid = z.uuid();
export const dateTime = z.iso.datetime({ offset: true }).transform((s) => new Date(s));
