// Read at call time (not import time) so tests can change env vars.
export const config = () => {
  const env = process.env;
  return {
    port: Number(env.PORT ?? 3000),
    databaseUrl: env.DATABASE_URL ?? 'postgres://pastebin:pastebin@localhost:5433/pastebin',
    redisUrl: env.REDIS_URL ?? 'redis://localhost:6380/0',
    s3: {
      endpoint: env.S3_ENDPOINT ?? 'http://localhost:9000',
      bucket: env.S3_BUCKET ?? 'pastebin',
      accessKey: env.S3_ACCESS_KEY ?? 'minioadmin',
      secretKey: env.S3_SECRET_KEY ?? 'minioadmin',
    },
    cacheEnabled: env.CACHE_ENABLED !== 'false',
    rateLimitPerMin: Number(env.RATE_LIMIT_PER_MIN ?? 10), // 0 = off
    publicBaseUrl: env.PUBLIC_BASE_URL ?? 'http://localhost:8080',
  };
};
