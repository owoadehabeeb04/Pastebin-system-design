import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { newDataSource } from './db';
import { Note } from './note.entity';

// Which shard holds a code. The ONLY place that decides this.
export const shardIndex = (code: string, shardCount: number) =>
  [...code].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0) % shardCount;

@Injectable()
export class Shards implements OnModuleInit, OnModuleDestroy {
  // ponytail: one Postgres locally. Real design: one DataSource per shard primary here.
  private sources: DataSource[] = [newDataSource()];

  async onModuleInit() {
    await Promise.all(this.sources.map((s) => s.initialize()));
  }

  async onModuleDestroy() {
    await Promise.all(this.sources.map((s) => s.destroy()));
  }

  forCode(code: string): Repository<Note> {
    return this.sources[shardIndex(code, this.sources.length)].getRepository(Note);
  }

  all(): Repository<Note>[] {
    return this.sources.map((s) => s.getRepository(Note));
  }
}
