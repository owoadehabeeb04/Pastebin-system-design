import { NestExpressApplication } from '@nestjs/platform-express';
import { CleanupService } from '../src/cleanup.service';
import { Shards } from '../src/shards';
import { StorageService } from '../src/storage.service';
import { createApp } from './helpers';

describe('cleanup job', () => {
  let app: NestExpressApplication;
  let shards: Shards;
  let storage: StorageService;

  beforeAll(async () => {
    app = await createApp();
    shards = app.get(Shards);
    storage = app.get(StorageService);
  });
  afterAll(() => app.close());

  const row = (code: string, expiresInMs: number, s3Key: string | null = null) => ({
    code, text: s3Key ? null : 'x', s3Key, type: 'plain_text' as const, language: null, deviceInfo: null, expiresAt: new Date(Date.now() + expiresInMs),
  });
  const exists = async (code: string) => (await shards.forCode(code).countBy({ code })) === 1;
  const fileExists = (key: string) => storage.get(key).then(() => true, () => false);

  it('removes expired rows and their S3 files, and leaves unexpired ones', async () => {
    await shards.all()[0].query('DELETE FROM notes');
    await storage.put('pastes/old-file', 'old');
    await storage.put('pastes/new-file', 'new');
    await shards.forCode('oldsmal').insert(row('oldsmal', -5000));
    await shards.forCode('oldbig1').insert(row('oldbig1', -5000, 'pastes/old-file'));
    await shards.forCode('newsmal').insert(row('newsmal', 60_000));
    await shards.forCode('newbig1').insert(row('newbig1', 60_000, 'pastes/new-file'));

    const deleted = await app.get(CleanupService).run();

    expect(deleted).toBe(2);
    expect(await exists('oldsmal')).toBe(false);
    expect(await exists('oldbig1')).toBe(false);
    expect(await fileExists('pastes/old-file')).toBe(false);
    expect(await exists('newsmal')).toBe(true);
    expect(await exists('newbig1')).toBe(true);
    expect(await fileExists('pastes/new-file')).toBe(true);
    await storage.deleteMany(['pastes/new-file']);
  });

  it('keeps the rows when the S3 delete fails, so the next run can retry', async () => {
    await shards.all()[0].query('DELETE FROM notes');
    await shards.forCode('failing').insert(row('failing', -5000, 'pastes/x'));
    jest.spyOn(storage, 'deleteMany').mockRejectedValueOnce(new Error('S3 down'));
    await expect(app.get(CleanupService).run()).rejects.toThrow('S3 down');
    expect(await exists('failing')).toBe(true);
    expect(await app.get(CleanupService).run()).toBe(1); // S3 back: now it goes
  });

  it('handles more rows than one batch', async () => {
    await shards.all()[0].query('DELETE FROM notes');
    await shards.all()[0].query(
      `INSERT INTO notes (code, text, type, expires_at)
       SELECT lpad(g::text, 7, '0'), 'x', 'plain_text', now() - interval '1 minute' FROM generate_series(1, 2500) g`,
    );
    expect(await app.get(CleanupService).run()).toBe(2500);
  });
});
