/**
 * Deterministic randomness. Every generated number in the prototype comes from
 * either the sequential mulberry32 stream or the stateless cell hash below, both
 * keyed on SEED, so the same filters always show the same numbers.
 */
export const SEED = 20261018;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mix(h: number, k: number): number {
  k = Math.imul(k, 0xcc9e2d51);
  k = (k << 15) | (k >>> 17);
  k = Math.imul(k, 0x1b873593);
  h ^= k;
  h = (h << 13) | (h >>> 19);
  return (Math.imul(h, 5) + 0xe6546b64) | 0;
}

/** Stateless hash of up to four integers to [0, 1). Used for per-cell noise. */
export function hash01(a: number, b = 0, c = 0, d = 0): number {
  let h = mix(mix(mix(mix(SEED, a), b), c), d);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Bounded, roughly normal noise with mean 0 and sd 1 (range −3…3). */
export function hashNormal(a: number, b = 0, c = 0, d = 0): number {
  return (hash01(a, b, c, d) + hash01(a, b, c, d + 7919) + hash01(a, b, c, d + 15887) - 1.5) * 2;
}

/** Uniform noise in [−1, 1). */
export function hashSigned(a: number, b = 0, c = 0, d = 0): number {
  return hash01(a, b, c, d) * 2 - 1;
}
