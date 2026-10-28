/**
 * seeded-random.js - deterministic Math.random for tests
 *
 * distributions.js draws from Math.random directly, so installing a seeded
 * generator with vi.spyOn makes samplers reproducible without production code
 * changes. Only compare single updates on identical streams: whole chains can
 * legitimately diverge through floating-point differences in summation order.
 */

import { vi } from 'vitest';

/**
 * mulberry32: a small 32-bit PRNG with good statistical quality for tests.
 * @param {number} seed
 * @returns {() => number} uniform draws in [0, 1)
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Replace Math.random with a seeded stream. Undo with the returned spy's
 * mockRestore() (or vi.restoreAllMocks()).
 * @param {number} seed
 */
export function installSeededRandom(seed) {
  const rng = mulberry32(seed);
  return vi.spyOn(Math, 'random').mockImplementation(rng);
}
