import { BadRequestException } from '@nestjs/common';

export const MAX_CHARS = 10_000;
export const MAX_INLINE_BYTES = 10 * 1024; // over this, text goes to S3
export const DEFAULT_TTL = 86_400;
export const MIN_TTL = 60;
export const MAX_TTL = 2_592_000;
export const CODE_RE = /^[0-9a-zA-Z]{7}$/;

export interface CreateInput {
  text: string;
  type: 'code' | 'plain_text';
  language: string | null;
  expiresIn: number;
}

export function validateCreate(body: any): CreateInput {
  const { text, type, language, expiresIn = DEFAULT_TTL } = body ?? {};
  if (typeof text !== 'string' || text.length === 0) throw new BadRequestException('text must be a non-empty string');
  // .length counts UTF-16 units, which is >= characters, so only count real characters when it is large
  if (text.length > MAX_CHARS && [...text].length > MAX_CHARS) throw new BadRequestException(`text is over ${MAX_CHARS} characters`);
  if (type !== 'code' && type !== 'plain_text') throw new BadRequestException('type must be "code" or "plain_text"');
  if (language !== undefined && (typeof language !== 'string' || language.length > 50)) throw new BadRequestException('language must be a string up to 50 characters');
  if (!Number.isInteger(expiresIn) || expiresIn < MIN_TTL || expiresIn > MAX_TTL) throw new BadRequestException(`expiresIn must be a whole number of seconds from ${MIN_TTL} to ${MAX_TTL}`);
  return { text, type, language: language ?? null, expiresIn };
}
