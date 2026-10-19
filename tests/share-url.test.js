import { describe, it, expect } from 'vitest';
import { encodeModel, decodeModel, buildShareUrl, readModelFromHash } from '../src/utils/share-url.js';
import { defaultModel1, defaultModel2, defaultModel3,
         defaultModel4, defaultModel5 } from '../src/data/default-data.js';

describe('share-url', () => {
  const models = { defaultModel1, defaultModel2, defaultModel3, defaultModel4, defaultModel5 };

  for (const [name, text] of Object.entries(models)) {
    it(`round-trips ${name}`, async () => {
      const encoded = await encodeModel(text);
      expect(encoded).toMatch(/^1\.[A-Za-z0-9_-]+$/);
      expect(await decodeModel(encoded)).toBe(text);
    });
  }

  it('produces a link shorter than the model text', async () => {
    const encoded = await encodeModel(defaultModel2);
    expect(encoded.length).toBeLessThan(defaultModel2.length);
  });

  it('preserves whitespace, comments and non-ASCII characters', async () => {
    const text = 'model {\n\t# σ is the SD — “quoted” 🐟\n  y ~ dnorm(0, 1)\r\n}\n\n';
    expect(await decodeModel(await encodeModel(text))).toBe(text);
  });

  it('round-trips an empty model', async () => {
    expect(await decodeModel(await encodeModel(''))).toBe('');
  });

  it('builds a URL that can be read back via the hash', async () => {
    const url = await buildShareUrl(defaultModel1, 'https://example.org/FANGS/index.html#old');
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://example.org/FANGS/index.html');
    const encoded = readModelFromHash(parsed.hash);
    expect(await decodeModel(encoded)).toBe(defaultModel1);
  });

  it('readModelFromHash returns null when no model is present', () => {
    expect(readModelFromHash('')).toBeNull();
    expect(readModelFromHash('#other=1')).toBeNull();
  });

  it('rejects malformed, unknown-version and truncated links', async () => {
    await expect(decodeModel('nodot')).rejects.toThrow(/malformed/);
    await expect(decodeModel('9.abc')).rejects.toThrow(/unsupported/);
    await expect(decodeModel('1.ab$c')).rejects.toThrow(/invalid characters/);
    const encoded = await encodeModel(defaultModel2);
    await expect(decodeModel(encoded.slice(0, encoded.length - 20))).rejects.toThrow(/corrupted/);
  });
});
