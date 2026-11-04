import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { config } from './config';
import { RedisService } from './redis.service';

export const rateKey = (ip: string) => `rate:${ip}`;

// At most N pastes a minute per IP. The count lives in Redis, so every API server sees the same number.
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private redis: RedisService) {}

  async canActivate(ctx: ExecutionContext) {
    const limit = config().rateLimitPerMin;
    if (limit <= 0) return true;
    const key = rateKey(ctx.switchToHttp().getRequest().ip);
    let count: number;
    try {
      // One round trip. EXPIRE ... NX sets the 60s window only on the first hit, so it never slides.
      const res = await this.redis.client.multi().incr(key).expire(key, 60, 'NX').exec();
      count = Number(res![0][1]);
    } catch {
      return true; // ponytail: Redis down = limiter off (fail open). Fail closed if abuse matters more than uptime.
    }
    if (count > limit) throw new HttpException('Too many requests, try again in a minute', HttpStatus.TOO_MANY_REQUESTS);
    return true;
  }
}
