import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { config } from './config';

@Injectable()
export class RedisService implements OnModuleDestroy {
  // Fail fast when Redis is down: the cache and rate limiter then step aside instead of hanging requests.
  readonly client = new Redis(config().redisUrl, { maxRetriesPerRequest: 1, commandTimeout: 500 });

  constructor() {
    this.client.on('error', () => {}); // ioredis retries by itself; callers handle failed commands
  }

  async onModuleDestroy() {
    await this.client.quit().catch(() => {});
  }
}
