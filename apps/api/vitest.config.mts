import fs from 'node:fs';
import { defineConfig } from 'vitest/config';

if (fs.existsSync('.env')) process.loadEnvFile('.env');

const testUrl = process.env.DATABASE_URL_TEST;
if (!testUrl) throw new Error('DATABASE_URL_TEST is not set (see .env.example).');
if (testUrl === process.env.DATABASE_URL || testUrl === process.env.DIRECT_URL) {
  throw new Error('DATABASE_URL_TEST must point to a separate database: tests wipe it.');
}

export default defineConfig({
  test: {
    env: {
      DATABASE_URL: testUrl,
      DIRECT_URL: testUrl,
      NODE_ENV: 'test',
      JWT_SECRET: 'test-secret',
      GOOGLE_CLIENT_ID: 'test-client-id',
      ADMIN_EMAILS: 'admin@usm.ro',
      BOOKING_MAX_DAYS_AHEAD: '14',
      CANCEL_CUTOFF_MINUTES: '0',
    },
    globalSetup: './test/globalSetup.ts',
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
