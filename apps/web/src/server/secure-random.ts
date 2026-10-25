/**
 * Unbiased random strings from a fixed alphabet.
 *
 * `randomBytes()[i] % alphabet.length` is biased whenever 256 is not a multiple
 * of the alphabet size (e.g. a 54- or 31-char alphabet makes the first symbols
 * more likely). `crypto.randomInt` uses rejection sampling, so every symbol is
 * equally likely and the code keeps its full entropy.
 */
import { randomInt } from 'node:crypto';

export function randomStringFromAlphabet(alphabet: string, length: number): string {
  if (alphabet.length < 2) throw new Error('alphabet must have at least 2 symbols');
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}
