/**
 * make-zip.js
 *
 * Minimal, dependency-free ZIP writer. Uses the STORE method (no compression),
 * which keeps this to ~100 lines and is fine for the small text files we bundle —
 * every unzip tool reads STORE archives.
 *
 * Only what a build script needs: given a list of { name, data } entries,
 * produce a single Buffer holding a valid .zip.
 */

import { createHash } from 'node:crypto';

/** CRC-32 (IEEE 802.3), table built once on first use. */
let CRC_TABLE = null;

function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  CRC_TABLE = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    CRC_TABLE[n] = c;
  }
  return CRC_TABLE;
}

function crc32(buf) {
  const table = crcTable();
  let c = 0 ^ (-1);
  for (let i = 0; i < buf.length; i++) {
    c = (c >>> 8) ^ table[(c ^ buf[i]) & 0xFF];
  }
  return (c ^ (-1)) >>> 0;
}

/**
 * Convert a JS Date to the DOS date/time pair ZIP headers use.
 * DOS time has 2-second resolution and an epoch of 1980.
 */
function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  const time =
    ((date.getHours() & 0x1F) << 11) |
    ((date.getMinutes() & 0x3F) << 5) |
    ((Math.floor(date.getSeconds() / 2)) & 0x1F);
  const day =
    (((year - 1980) & 0x7F) << 9) |
    (((date.getMonth() + 1) & 0x0F) << 5) |
    (date.getDate() & 0x1F);
  return { time, day };
}

/**
 * Build a ZIP archive.
 *
 * @param {Array<{name: string, data: Buffer|string}>} entries
 *        Archive members. `name` is the path inside the zip (forward slashes).
 * @param {object} [opts]
 * @param {Date}   [opts.date] Timestamp stamped on every entry. Pass a fixed
 *        date for reproducible output (so rebuilds don't churn git).
 * @returns {Buffer} the complete .zip file
 */
export function makeZip(entries, opts = {}) {
  const date = opts.date ?? new Date();
  const { time: dosTime, day: dosDay } = dosDateTime(date);

  const localParts = [];   // local file header + data, in order
  const centralParts = []; // central directory records
  let offset = 0;          // running offset of the next local header

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const dataBuf = Buffer.isBuffer(entry.data)
      ? entry.data
      : Buffer.from(entry.data, 'utf8');
    const crc = crc32(dataBuf);

    // ---- local file header (30 bytes + name) ----
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034B50, 0);  // signature
    local.writeUInt16LE(20, 4);          // version needed (2.0)
    local.writeUInt16LE(0x0800, 6);      // flags: bit 11 = UTF-8 names
    local.writeUInt16LE(0, 8);           // method 0 = STORE
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDay, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(dataBuf.length, 18); // compressed size
    local.writeUInt32LE(dataBuf.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);          // extra field length
    localParts.push(local, nameBuf, dataBuf);

    // ---- central directory record (46 bytes + name) ----
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014B50, 0); // signature
    central.writeUInt16LE(20, 4);         // version made by
    central.writeUInt16LE(20, 6);         // version needed
    central.writeUInt16LE(0x0800, 8);     // flags: UTF-8
    central.writeUInt16LE(0, 10);         // method STORE
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDay, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(dataBuf.length, 20);
    central.writeUInt32LE(dataBuf.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);         // extra length
    central.writeUInt16LE(0, 32);         // comment length
    central.writeUInt16LE(0, 34);         // disk number start
    central.writeUInt16LE(0, 36);         // internal attrs
    central.writeUInt32LE(0o644 << 16, 38); // external attrs (unix 0644)
    central.writeUInt32LE(offset, 42);    // offset of local header
    centralParts.push(central, nameBuf);

    offset += local.length + nameBuf.length + dataBuf.length;
  }

  const centralBuf = Buffer.concat(centralParts);

  // ---- end of central directory (22 bytes) ----
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054B50, 0);       // signature
  end.writeUInt16LE(0, 4);                // this disk
  end.writeUInt16LE(0, 6);                // disk with central dir
  end.writeUInt16LE(entries.length, 8);   // entries on this disk
  end.writeUInt16LE(entries.length, 10);  // total entries
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);          // central dir offset
  end.writeUInt16LE(0, 20);               // comment length

  return Buffer.concat([...localParts, centralBuf, end]);
}

/** Short content hash, used to report whether a rebuilt zip actually changed. */
export function digest(buf) {
  return createHash('sha256').update(buf).digest('hex').slice(0, 12);
}
