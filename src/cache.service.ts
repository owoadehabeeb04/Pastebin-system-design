import { Injectable } from '@nestjs/common';
import { config } from './config';
import { RedisService } from './redis.service';

export interface Paste {
  code: string;
  text: string | null;
  type: 'code' | 'plain_text';
  language: string | null;
  expiresAt: string;
}

const MISSING_TTL_MS = 30_000;
export const cacheKey = (code: string) => `paste:${code}`;

// undefined = not cached (or cache off / Redis down). null = known to not exist.
@Injectable()
export class CacheService {
  constructor(private redis: RedisService) {}

  async get(code: string): Promise<Paste | null | undefined> {
    if (!config().cacheEnabled) return undefined;
    try {
      const raw = await this.redis.client.get(cacheKey(code));
      return raw === null ? undefined : JSON.parse(raw);
    } catch {
      return undefined; // Redis trouble must never break a read: fall back to Postgres
    }
  }

  // Lives exactly until the paste expires, so Redis never serves an expired paste.
  async setPaste(paste: Paste) {
    const ttlMs = new Date(paste.expiresAt).getTime() - Date.now();
    if (ttlMs > 0) await this.set(paste.code, paste, ttlMs);
  }

  setMissing(code: string) {
    return this.set(code, null, MISSING_TTL_MS);
  }

  private async set(code: string, value: Paste | null, ttlMs: number) {
    if (!config().cacheEnabled) return;
    try {
      await this.redis.client.set(cacheKey(code), JSON.stringify(value), 'PX', ttlMs);
    } catch {
      // not cached; the next read just asks Postgres again
    }
  }
}
