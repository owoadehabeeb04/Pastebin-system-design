import { randomUUID } from 'crypto';
import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { CacheService, Paste } from './cache.service';
import { CodeGenerator } from './code.generator';
import { config } from './config';
import { Shards } from './shards';
import { StorageService } from './storage.service';
import { CODE_RE, CreateInput, MAX_INLINE_BYTES } from './validate';

const MAX_CODE_TRIES = 5;

@Injectable()
export class PastesService {
  constructor(private shards: Shards, private codes: CodeGenerator, private cache: CacheService, private storage: StorageService) {}

  async create(input: CreateInput, userAgent?: string) {
    const expiresAt = new Date(Date.now() + input.expiresIn * 1000);
    // Over 10 KB (bytes, not characters): the text goes to S3 first, Postgres keeps only the key.
    // The key is random, not the code, because the code is not decided until the insert succeeds.
    let s3Key: string | null = null;
    if (Buffer.byteLength(input.text) > MAX_INLINE_BYTES) {
      s3Key = `pastes/${randomUUID()}`;
      await this.storage.put(s3Key, input.text);
    }
    // Insert and let Postgres reject a duplicate. No "check first": two servers could pick the same code.
    for (let i = 0; i < MAX_CODE_TRIES; i++) {
      const code = this.codes.next();
      try {
        await this.shards.forCode(code).insert({
          code,
          text: s3Key ? null : input.text,
          s3Key,
          type: input.type,
          language: input.language,
          deviceInfo: userAgent?.slice(0, 512) ?? null,
          expiresAt,
        });
        return { code, url: `${config().publicBaseUrl}/pastes/${code}`, expiresAt: expiresAt.toISOString() };
      } catch (e: any) {
        if ((e.driverError?.code ?? e.code) !== '23505') throw e; // 23505 = duplicate key
      }
    }
    if (s3Key) await this.storage.deleteMany([s3Key]).catch(() => {}); // ponytail: a crash here leaves an orphan file; a sweep of S3 vs Postgres would catch it
    throw new InternalServerErrorException('could not find a free code');
  }

  // Read-through cache: Redis first, then Postgres, then save a copy in Redis.
  async get(code: string): Promise<Paste> {
    if (!CODE_RE.test(code)) throw new NotFoundException();

    const cached = await this.cache.get(code);
    if (cached === null) throw new NotFoundException(); // cached "does not exist"
    if (cached) {
      // Redis TTL should already have removed it, but never trust that alone.
      if (new Date(cached.expiresAt).getTime() <= Date.now()) throw new NotFoundException();
      return cached;
    }

    const note = await this.shards.forCode(code).findOneBy({ code });
    if (!note || note.expiresAt.getTime() <= Date.now()) {
      await this.cache.setMissing(code);
      throw new NotFoundException();
    }
    const text = note.s3Key ? await this.storage.get(note.s3Key) : note.text;
    const paste: Paste = { code, text, type: note.type, language: note.language, expiresAt: note.expiresAt.toISOString() };
    await this.cache.setPaste(paste);
    return paste;
  }
}
