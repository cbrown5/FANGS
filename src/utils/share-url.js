/**
 * share-url.js
 * Encode / decode BUGS model text into a compact URL fragment so a model can
 * be shared as a link.
 *
 * Format: `#m=<version>.<payload>` where payload is the UTF-8 model text,
 * compressed with raw DEFLATE (CompressionStream) and base64url-encoded.
 * The fragment is never sent to the server, so this works with static
 * hosting and file:// alike.
 */

const HASH_KEY = 'm';
const FORMAT_VERSION = '1';

/** @param {Uint8Array} bytes */
function toBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** @param {string} str */
function fromBase64Url(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Pipe bytes through a (De)CompressionStream and collect the output. */
async function pipeThrough(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/**
 * Compress model text into a URL-safe string (without the `#m=` prefix).
 * @param {string} modelText
 * @returns {Promise<string>} e.g. "1.y8xPLU..."
 */
export async function encodeModel(modelText) {
  const raw = new TextEncoder().encode(modelText);
  const compressed = await pipeThrough(raw, new CompressionStream('deflate-raw'));
  return `${FORMAT_VERSION}.${toBase64Url(compressed)}`;
}

/**
 * Decompress a string produced by {@link encodeModel}.
 * @param {string} encoded
 * @returns {Promise<string>} The original model text
 * @throws {Error} If the string is malformed or uses an unknown version
 */
export async function decodeModel(encoded) {
  const dot = encoded.indexOf('.');
  if (dot < 0) throw new Error('Shared model link is malformed.');
  const version = encoded.slice(0, dot);
  if (version !== FORMAT_VERSION) {
    throw new Error(`Shared model link uses an unsupported format (v${version}).`);
  }
  const payload = encoded.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(payload)) {
    throw new Error('Shared model link contains invalid characters.');
  }
  try {
    const bytes = await pipeThrough(fromBase64Url(payload), new DecompressionStream('deflate-raw'));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('Shared model link is corrupted or incomplete.');
  }
}

/**
 * Build a full shareable URL for the given model text.
 * @param {string} modelText
 * @param {string} baseUrl - Current page URL; any existing fragment is dropped
 * @returns {Promise<string>}
 */
export async function buildShareUrl(modelText, baseUrl) {
  const url = new URL(baseUrl);
  url.hash = `${HASH_KEY}=${await encodeModel(modelText)}`;
  return url.toString();
}

/**
 * Extract the encoded model from a location hash, if present.
 * @param {string} hash - e.g. `location.hash` ("#m=1.abc")
 * @returns {string|null} The encoded value, or null if no model is in the hash
 */
export function readModelFromHash(hash) {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  return params.get(HASH_KEY);
}
