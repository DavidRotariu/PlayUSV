import { execSync } from 'node:child_process';

/** Applies the migrations to the test database once per run. */
export default function setup() {
  const url = process.env.DATABASE_URL_TEST!;
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
    stdio: 'ignore',
  });
}
