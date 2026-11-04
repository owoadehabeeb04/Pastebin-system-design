import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('notes')
export class Note {
  @PrimaryColumn({ type: 'char', length: 7 })
  code: string;

  @Column({ name: 'user_id', type: 'bigint', nullable: true })
  userId: string | null;

  @Column({ type: 'text', nullable: true })
  text: string | null;

  @Column({ name: 's3_key', type: 'text', nullable: true })
  s3Key: string | null;

  @Column({ type: 'text' })
  type: 'code' | 'plain_text';

  @Column({ type: 'text', nullable: true })
  language: string | null;

  @Column({ name: 'device_info', type: 'text', nullable: true })
  deviceInfo: string | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;
}
