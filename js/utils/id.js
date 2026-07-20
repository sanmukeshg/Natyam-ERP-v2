/**
 * Identifier generation.
 *
 * Ids are lexicographically sortable by creation time, which means an index on
 * the primary key doubles as a chronological index and "newest first" needs no
 * separate field.
 */

let counter = Math.floor(Math.random() * 4096);

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32, no I/L/O/U

function encode(value, length) {
    let out = '';
    let n = value;
    for (let i = 0; i < length; i += 1) {
        out = ALPHABET[n % 32] + out;
        n = Math.floor(n / 32);
    }
    return out;
}

/**
 * `PREFIX-TTTTTTTT-CCCRRRR`
 *   T: 40-bit millisecond timestamp — sortable to the millisecond
 *   C: per-tick counter — distinguishes records minted in the same loop
 *   R: crypto randomness — survives two devices minting at the same instant
 */
export function uid(prefix = 'ID') {
    counter = (counter + 1) % 32768;

    const time = encode(Date.now(), 8);
    const seq = encode(counter, 3);

    const bytes = new Uint8Array(3);
    (globalThis.crypto || {}).getRandomValues?.(bytes);
    const random = Array.from(bytes, (b) => ALPHABET[b % 32]).join('') || encode(Math.floor(Math.random() * 32768), 3);

    return `${prefix}-${time}-${seq}${random}`;
}

/** Recovers the creation timestamp encoded in an id. */
export function uidTime(id) {
    const part = String(id).split('-')[1];
    if (!part) return null;
    let value = 0;
    for (const char of part) {
        const index = ALPHABET.indexOf(char);
        if (index < 0) return null;
        value = value * 32 + index;
    }
    return new Date(value);
}

/**
 * Human-facing sequence numbers: admission numbers, receipt numbers, invoice
 * numbers, certificate serials. These appear on paper handed to a parent, so
 * they must be short, readable over the phone, and gap-free within their year.
 *
 * @param {string} prefix  e.g. 'NAT/ADM'
 * @param {number} year    Academic year start, e.g. 2026
 * @param {number} next    The next sequence value, supplied by the caller who
 *                         owns the counter (kept in the settings store so it
 *                         survives a record being deleted).
 */
export function sequenceNumber(prefix, year, next) {
    return `${prefix}/${String(year).slice(-2)}/${String(next).padStart(4, '0')}`;
}

/** Stable 1–6 tint for avatars, so a person is always the same colour. */
export function tintOf(value) {
    const text = String(value || '');
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) | 0;
    return (Math.abs(hash) % 6) + 1;
}

/** Up to two initials from a person's name. */
export function initialsOf(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
