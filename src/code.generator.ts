import { Injectable } from '@nestjs/common';
import { randomInt } from 'crypto';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

// Its own class so tests can swap it to force a collision.
@Injectable()
export class CodeGenerator {
  next(): string {
    let code = '';
    for (let i = 0; i < 7; i++) code += ALPHABET[randomInt(ALPHABET.length)];
    return code;
  }
}
