import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CacheService } from './cache.service';
import { CleanupService } from './cleanup.service';
import { CodeGenerator } from './code.generator';
import { PastesController } from './pastes.controller';
import { PastesService } from './pastes.service';
import { RateLimitGuard } from './rate-limit.guard';
import { RedisService } from './redis.service';
import { Shards } from './shards';
import { StorageService } from './storage.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [PastesController],
  providers: [Shards, CodeGenerator, RedisService, CacheService, RateLimitGuard, StorageService, CleanupService, PastesService],
})
export class AppModule {}
