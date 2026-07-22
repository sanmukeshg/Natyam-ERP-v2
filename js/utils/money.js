/**
 * Money.
 *
 * The school works in whole rupees. Fees, salaries and expenses are never
 * quoted in paise, and nothing in the application asks for a decimal amount.
 *
 * Amounts were previously stored as scaled integer paise, which produced a
 * compounding error: a form rendered the stored value straight into a rupee
 * input and then multiplied it again on save, so ₹1,500 became ₹150,000 and
 * then ₹15,00,000. The scaling is gone. What is typed, what is stored and what
 * is displayed are now the same whole number, so there is no factor left to
 * apply twice.
 */

/** Any input — typed, imported or already numeric — to a whole-rupee integer. */
export function toAmount(value) {
    if (value === null || value === undefined || value === '') return 0;
    // Imports arrive with separators and symbols; strip anything that is not
    // part of a number before parsing.
    const n = typeof value === 'number' ? value : Number(String(value).replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? Math.round(n) : 0;
}

/** Percentage of an amount, rounded to the rupee. Used for discounts. */
export function percentOf(amount, percent) {
    return Math.round((toAmount(amount) * (Number(percent) || 0)) / 100);
}

/* ------------------------------------------------------------- FORMATTING */

const INR_WHOLE = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
});

const PLAIN = new Intl.NumberFormat('en-IN');

/** ₹1,23,456.00 — Indian grouping, which Intl handles correctly for en-IN. */
export function formatMoney(amount) {
    return INR_WHOLE.format(toAmount(amount));
}

/**
 * Compact form for KPI cards and chart axes, using lakh and crore rather than
 * K/M. A registrar in Hyderabad reads ₹4.2L instantly and ₹420K not at all.
 */
export function formatMoneyShort(amount) {
    const rupees = toAmount(amount);
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

export function amountInWords(amount) {
    // Whole rupees only — receipts never carry a paise line.
    const rupees = toAmount(amount);

    if (rupees === 0) return 'Zero rupees only';

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

    const out = words ? `${words} rupees` : '';
    return `${out.charAt(0).toUpperCase()}${out.slice(1)} only`;
}
