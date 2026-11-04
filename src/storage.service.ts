import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { config } from './config';

// Large pastes live here. Plain S3 calls, so MinIO, SeaweedFS or real S3 all work.
@Injectable()
export class StorageService implements OnModuleInit {
  private bucket = config().s3.bucket;
  private s3 = new S3Client({
    endpoint: config().s3.endpoint,
    region: 'us-east-1',
    forcePathStyle: true, // bucket in the path, not the hostname: needed for local stand-ins
    credentials: { accessKeyId: config().s3.accessKey, secretAccessKey: config().s3.secretKey },
  });

  // Make sure the bucket exists. Retries because the S3 container may still be starting.
  async onModuleInit() {
    for (let i = 0; i < 15; i++) {
      try {
        await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
        return;
      } catch {
        try {
          await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }
    new Logger('Storage').warn(`could not reach bucket "${this.bucket}"; large pastes will fail`);
  }

  async put(key: string, text: string) {
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: text, ContentType: 'text/plain; charset=utf-8' }));
  }

  async get(key: string): Promise<string> {
    const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return res.Body!.transformToString('utf-8');
  }

  // Deleting a key that is already gone is not an error, so two cleanup jobs can overlap safely.
  async deleteMany(keys: string[]) {
    if (!keys.length) return;
    const res = await this.s3.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true } }));
    if (res.Errors?.length) throw new Error(`S3 delete failed for ${res.Errors.length} keys: ${res.Errors[0].Message}`);
  }
}
