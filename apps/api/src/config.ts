function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  isDev: process.env.NODE_ENV === 'development',
  jwtSecret: required('JWT_SECRET'),
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  adminEmails: (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
  // Not yet decided by the client; see README.
  maxDaysAhead: Number(process.env.BOOKING_MAX_DAYS_AHEAD ?? 14),
  cancelCutoffMinutes: Number(process.env.CANCEL_CUTOFF_MINUTES ?? 0),
};
