import { CodeGenerator } from './code.generator';
import { shardIndex } from './shards';
import { validateCreate } from './validate';

describe('CodeGenerator', () => {
  it('makes 7 characters from 0-9 a-z A-Z', () => {
    const g = new CodeGenerator();
    for (let i = 0; i < 1000; i++) expect(g.next()).toMatch(/^[0-9a-zA-Z]{7}$/);
  });
});

describe('shardIndex', () => {
  it('is stable and inside the range', () => {
    expect(shardIndex('abc1234', 4)).toBe(shardIndex('abc1234', 4));
    for (const code of ['aaaaaaa', 'ZZZZZZZ', '0123456']) expect(shardIndex(code, 3)).toBeLessThan(3);
    expect(shardIndex('abc1234', 1)).toBe(0);
  });
});

describe('validateCreate', () => {
  const ok = { text: 'hi', type: 'plain_text' };

  it('accepts 10,000 characters and rejects 10,001', () => {
    expect(validateCreate({ ...ok, text: 'a'.repeat(10_000) }).text).toHaveLength(10_000);
    expect(() => validateCreate({ ...ok, text: 'a'.repeat(10_001) })).toThrow();
  });

  it('counts characters, not UTF-16 units (emoji is 2 units, 1 character)', () => {
    expect(() => validateCreate({ ...ok, text: '😀'.repeat(10_000) })).not.toThrow();
    expect(() => validateCreate({ ...ok, text: '😀'.repeat(10_001) })).toThrow();
  });

  it('rejects empty text and a missing or bad type', () => {
    expect(() => validateCreate({ ...ok, text: '' })).toThrow();
    expect(() => validateCreate({ text: 'hi' })).toThrow();
    expect(() => validateCreate({ ...ok, type: 'html' })).toThrow();
    expect(() => validateCreate(undefined)).toThrow();
  });

  it('defaults expiresIn to 1 day and enforces 60s..30 days', () => {
    expect(validateCreate(ok).expiresIn).toBe(86_400);
    expect(validateCreate({ ...ok, expiresIn: 60 }).expiresIn).toBe(60);
    expect(validateCreate({ ...ok, expiresIn: 2_592_000 }).expiresIn).toBe(2_592_000);
    for (const bad of [59, 2_592_001, 1.5, '60', null]) expect(() => validateCreate({ ...ok, expiresIn: bad })).toThrow();
  });
});
