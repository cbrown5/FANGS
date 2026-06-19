/**
 * course-challenges.test.js — unit tests for the pure logic behind the course
 * challenge widgets (Module 1 Bayes maths, numeric tolerance helpers, and the
 * Module 4 parser-validity check). The widgets themselves are DOM-driven, but
 * their decision logic lives in framework-free modules tested here.
 */

import { describe, it, expect } from 'vitest';
import { withinAbs, withinRel, parseNum } from '../course/challenges/numeric.js';
import { numerators, denominator, posterior } from '../course/challenges/bayes-math.js';
import { Lexer } from '../src/parser/lexer.js';
import { Parser } from '../src/parser/parser.js';

describe('numeric tolerance helpers', () => {
  it('withinAbs respects an absolute tolerance', () => {
    expect(withinAbs(1.02, 1.0, 0.05)).toBe(true);
    expect(withinAbs(1.2, 1.0, 0.05)).toBe(false);
    expect(withinAbs(NaN, 1.0, 0.05)).toBe(false);
  });

  it('withinRel respects a relative tolerance with an absolute floor', () => {
    expect(withinRel(102, 100, 0.05)).toBe(true);
    expect(withinRel(120, 100, 0.05)).toBe(false);
    expect(withinRel(0.001, 0, 0.05, 0.01)).toBe(true); // near-zero target
  });

  it('parseNum tolerates whitespace and commas, rejects junk', () => {
    expect(parseNum(' 1,234.5 ')).toBeCloseTo(1234.5, 6);
    expect(parseNum('')).toBeNaN();
    expect(parseNum('abc')).toBeNaN();
  });
});

describe('discrete-Bayes maths (Module 1)', () => {
  const prior = [1 / 3, 1 / 3, 1 / 3];
  const likelihood = [0.6, 0.3, 0.1];

  it('numerator is prior × likelihood', () => {
    const n = numerators(prior, likelihood);
    expect(n[0]).toBeCloseTo(0.2, 10);
    expect(n[1]).toBeCloseTo(0.1, 10);
    expect(n[2]).toBeCloseTo(1 / 30, 10);
  });

  it('denominator is the sum of the numerators', () => {
    const n = numerators(prior, likelihood);
    expect(denominator(n)).toBeCloseTo(0.2 + 0.1 + 1 / 30, 10);
  });

  it('posterior is normalised and matches the hand calculation', () => {
    const post = posterior(prior, likelihood);
    expect(post.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    // With an equal prior the posterior is proportional to the likelihood.
    expect(post[0]).toBeCloseTo(0.6, 10);
    expect(post[1]).toBeCloseTo(0.3, 10);
    expect(post[2]).toBeCloseTo(0.1, 10);
  });

  it('a different prior changes the posterior', () => {
    const post = posterior([0.2, 0.5, 0.3], likelihood);
    expect(post[0]).not.toBeCloseTo(0.6, 3);
    expect(post.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });
});

describe('parser-validity check (Module 4)', () => {
  const isValid = src => {
    try {
      new Parser(new Lexer(src).tokenize()).parse();
      return true;
    } catch (_) {
      return false;
    }
  };

  it('accepts a well-formed model', () => {
    const good = `model {
      for (i in 1:N) {
        length[i] ~ dnorm(mu, sigma)
      }
      mu ~ dnorm(40, 20)
      sigma ~ dunif(0, 50)
    }`;
    expect(isValid(good)).toBe(true);
  });

  it('rejects the seeded buggy model (missing closing paren)', () => {
    const bad = `model {
      for (i in 1:N) {
        y[i] ~ dnorm(mu, sigma
        mu <- alpha
      }
      alpha ~ dnorm(0, 5)
      sigma ~ dunif(0, 100)
    }`;
    expect(isValid(bad)).toBe(false);
  });
});
