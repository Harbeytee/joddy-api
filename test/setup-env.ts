/** E2E tests run against a separate database so they never touch development data. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://macbook@localhost:5432/joddy_test';

export const TEST_PORT = Number(process.env.TEST_PORT ?? 4100);
export const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

export const TEST_ENV = {
  NODE_ENV: 'test',
  PORT: String(TEST_PORT),
  DATABASE_URL: TEST_DATABASE_URL,
  CORS_ORIGINS: 'http://localhost:3000',
  JWT_ACCESS_SECRET: 'test-access-secret-test-access-secret-0000',
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_TTL_DAYS: '30',
  INGEST_API_KEY: 'test-ingest-key-0123456789abcdef',
  LOG_LEVEL: 'fatal',
};
