// Tests use their own database, Redis db and bucket so they never touch dev data.
process.env.DATABASE_URL = 'postgres://pastebin:pastebin@localhost:5433/pastebin_test';
process.env.REDIS_URL = 'redis://localhost:6380/1';
process.env.S3_BUCKET = 'pastebin-test';
process.env.RATE_LIMIT_PER_MIN = '0'; // the rate-limit test turns it on
process.env.CACHE_ENABLED = 'true';
