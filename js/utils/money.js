/**
 * Money.
 *
 * Amounts are stored as integer paise. Storing rupees as floats and rounding
 * on display is how a ledger ends up 0.03 out after four hundred part-payments,
 * and there is no way to find the error afterwards. Every arithmetic operation
 * in the fee and finance modules goes through this module.
 */

/** Rupees (number or numeric string) → integer paise. */
export function toPaise(rupees) {
    const n = Number(rupees);
    if (!Number.isFinite(n)) return 0;
    // Round the scaled value, not the input: 19.99 * 100 is 1998.9999... in
    // IEEE754, and truncation would lose a paisa on a very common amount.
    return Math.round(n * 100);
}

/** Integer paise → rupees as a number. Display only, never for arithmetic. */
export function toRupees(paise) {
    return Math.round(Number(paise) || 0) / 100;
}

export function addPaise(...values) {
    return values.reduce((sum, v) => sum + (Math.round(Number(v)) || 0), 0);
}

export function subPaise(a, b) {
    return (Math.round(Number(a)) || 0) - (Math.round(Number(b)) || 0);
}

/**
 * Percentage of an amount, rounded half-up to the paisa. Used for discounts
 * and scholarship rates.
 */
export function percentOf(paise, percent) {
    return Math.round(((Math.round(Number(paise)) || 0) * (Number(percent) || 0)) / 100);
}

/**
 * Splits an amount into n instalments without losing or inventing a paisa.
 * The remainder goes onto the first instalment, so the last one is never the
 * odd amount a parent has to query.
 */
export function splitInstalments(totalPaise, count) {
    const total = Math.round(Number(totalPaise)) || 0;
    const n = Math.max(1, Math.floor(count));
    const base = Math.floor(total / n);
    const remainder = total - base * n;
    return Array.from({ length: n }, (_, i) => (i === 0 ? base + remainder : base));
}

/* ------------------------------------------------------------- FORMATTING */

const INR = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
});

const INR_WHOLE = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
});

const PLAIN = new Intl.NumberFormat('en-IN');

/** ₹1,23,456.00 — Indian grouping, which Intl handles correctly for en-IN. */
export function formatMoney(paise, { whole = false } = {}) {
    const rupees = toRupees(paise);
    return whole || Number.isInteger(rupees) ? INR_WHOLE.format(rupees) : INR.format(rupees);
}

/**
 * Compact form for KPI cards and chart axes, using lakh and crore rather than
 * K/M. A registrar in Hyderabad reads ₹4.2L instantly and ₹420K not at all.
 */
export function formatMoneyShort(paise) {
    const rupees = toRupees(paise);
    const abs = Math.abs(rupees);
    const sign = rupees < 0 ? '-' : '';

    if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(abs >= 100000000 ? 0 : 2)}Cr`;
    if (abs >= 100000)   return `${sign}₹${(abs / 100000).toFixed(abs >= 1000000 ? 1 : 2)}L`;
    if (abs >= 1000)     return `${sign}₹${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}K`;
    return `${sign}₹${abs.toFixed(0)}`;
}

export function formatNumber(value) {
    return PLAIN.format(Number(value) || 0);
}

export function formatPercent(value, digits = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? `${n.toFixed(digits)}%` : '—';
}

/** Safe ratio as a percentage. Returns null rather than NaN on a zero base. */
export function ratio(part, whole) {
    const w = Number(whole) || 0;
    if (!w) return null;
    return ((Number(part) || 0) / w) * 100;
}

/**
 * Amount in words, for receipts. Indian convention, and required on any
 * printed receipt that may be shown to an auditor.
 */
const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function twoDigits(n) {
    if (n < 20) return ONES[n];
    const t = TENS[Math.floor(n / 10)];
    const o = ONES[n % 10];
    return o ? `${t}-${o}` : t;
}

function threeDigits(n) {
    const hundreds = Math.floor(n / 100);
    const rest = n % 100;
    const parts = [];
    if (hundreds) parts.push(`${ONES[hundreds]} hundred`);
    if (rest) parts.push(twoDigits(rest));
    return parts.join(' and ');
}

export function amountInWords(paise) {
    const rupees = Math.floor(toRupees(paise));
    const paiseRemainder = Math.round(Number(paise)) % 100;

    if (rupees === 0 && !paiseRemainder) return 'Zero rupees only';

    const groups = [
        [Math.floor(rupees / 10000000), 'crore'],
        [Math.floor((rupees % 10000000) / 100000), 'lakh'],
        [Math.floor((rupees % 100000) / 1000), 'thousand'],
        [rupees % 1000, '']
    ];

    const words = groups
        .filter(([value]) => value > 0)
        .map(([value, unit]) => `${threeDigits(value)}${unit ? ` ${unit}` : ''}`)
        .join(' ');

    let out = words ? `${words} rupees` : '';
    if (paiseRemainder) out += `${out ? ' and ' : ''}${twoDigits(paiseRemainder)} paise`;
    return `${out.charAt(0).toUpperCase()}${out.slice(1)} only`;
}
