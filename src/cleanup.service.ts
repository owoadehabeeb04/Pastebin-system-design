import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LessThan } from 'typeorm';
import { Shards } from './shards';
import { StorageService } from './storage.service';

const BATCH = 1000;

// Reads already refuse expired pastes. This only frees the space.
@Injectable()
export class CleanupService {
  private log = new Logger('Cleanup');

  constructor(private shards: Shards, private storage: StorageService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async hourly() {
    try {
      const n = await this.run();
      if (n) this.log.log(`deleted ${n} expired pastes`);
    } catch (e) {
      this.log.error(`cleanup failed, will retry next hour: ${e}`); // rows stay until the files are gone
    }
  }

  // Returns how many pastes were deleted.
  async run(): Promise<number> {
    let total = 0;
    for (const repo of this.shards.all()) {
      for (;;) {
        const expired = await repo.find({ select: { code: true, s3Key: true }, where: { expiresAt: LessThan(new Date()) }, take: BATCH });
        if (!expired.length) break;
        // Files first, rows second: if S3 fails the rows stay, so the next run retries. Never the other way
        // round, or we would lose track of the files.
        await this.storage.deleteMany(expired.flatMap((n) => (n.s3Key ? [n.s3Key] : [])));
        await repo.delete(expired.map((n) => n.code));
        total += expired.length;
      }
    }
    return total;
  }
}
