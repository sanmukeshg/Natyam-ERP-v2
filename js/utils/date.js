/**
 * Date handling.
 *
 * Rule for this codebase: anything that represents *a day* (attendance date,
 * due date, holiday) is a local `YYYY-MM-DD` string. Anything that represents
 * *an instant* (createdAt, audit timestamp) is a full ISO string in UTC.
 *
 * 1.0 used `new Date().toISOString().slice(0,10)` for attendance. In IST that
 * is the previous day until 05:30, so every early-morning class was filed
 * against the wrong date. Never call toISOString for a calendar day.
 */

const pad = (n) => String(n).padStart(2, '0');

/** Today, or any Date, as a local YYYY-MM-DD string. */
export function localDate(date = new Date()) {
    const d = date instanceof Date ? date : new Date(date);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parses YYYY-MM-DD as local midnight, not UTC midnight. */
export function parseDate(value) {
    if (value instanceof Date) return value;
    const [y, m, d] = String(value).split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
}

export function nowISO() {
    return new Date().toISOString();
}

export function addDays(value, days) {
    const d = parseDate(value);
    d.setDate(d.getDate() + days);
    return localDate(d);
}

export function addMonths(value, months) {
    const d = parseDate(value);
    const targetDay = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + months);
    // Clamp: 31 Jan + 1 month is 28/29 Feb, not 2/3 March.
    d.setDate(Math.min(targetDay, daysInMonth(d.getFullYear(), d.getMonth())));
    return localDate(d);
}

export function daysInMonth(year, monthIndex) {
    return new Date(year, monthIndex + 1, 0).getDate();
}

export function daysBetween(from, to) {
    const a = parseDate(from);
    const b = parseDate(to);
    return Math.round((b - a) / 86400000);
}

export function startOfMonth(value = new Date()) {
    const d = parseDate(localDate(value));
    d.setDate(1);
    return localDate(d);
}

export function endOfMonth(value = new Date()) {
    const d = parseDate(localDate(value));
    return localDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

/** Monday-first, matching the Indian school week. */
export function startOfWeek(value = new Date()) {
    const d = parseDate(localDate(value));
    const day = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - day);
    return localDate(d);
}

/** `YYYY-MM` — the grouping key for monthly ledgers and reports. */
export function monthKey(value = new Date()) {
    const d = parseDate(localDate(value));
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** The last n month keys, oldest first. Feeds every trend chart. */
export function lastMonths(n, from = new Date()) {
    const out = [];
    const d = parseDate(localDate(from));
    d.setDate(1);
    for (let i = n - 1; i >= 0; i -= 1) {
        const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
        out.push(`${m.getFullYear()}-${pad(m.getMonth() + 1)}`);
    }
    return out;
}

export function isToday(value) {
    return localDate(value) === localDate();
}

export function isPast(value) {
    return localDate(value) < localDate();
}

/**
 * The Indian academic year runs June–May. A date in April 2027 belongs to the
 * 2026–27 year, and getting this wrong misfiles a whole term of fees.
 */
export function academicYearOf(value = new Date()) {
    const d = parseDate(localDate(value));
    const start = d.getMonth() >= 5 ? d.getFullYear() : d.getFullYear() - 1;
    return { start, end: start + 1, label: `${start}–${String(start + 1).slice(-2)}` };
}

/* ------------------------------------------------------------- FORMATTING */

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function dayName(value, short = false) {
    const name = DAY_NAMES[parseDate(value).getDay()];
    return short ? name.slice(0, 3) : name;
}

/** `12 Mar 2026` — unambiguous, unlike any all-numeric format. */
export function formatDate(value, { withYear = true } = {}) {
    if (!value) return '';
    const d = parseDate(value);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getDate()} ${MONTH_NAMES[d.getMonth()]}${withYear ? ` ${d.getFullYear()}` : ''}`;
}

export function formatDateLong(value) {
    if (!value) return '';
    const d = parseDate(value);
    return `${dayName(d)}, ${formatDate(d)}`;
}

export function formatDateTime(value) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return `${formatDate(d)}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatMonth(key) {
    const [y, m] = String(key).split('-').map(Number);
    return `${MONTH_NAMES[(m || 1) - 1]} ${y}`;
}

/** "3 days ago", "in 2 weeks". Relative time is faster to parse for recency. */
export function relativeTime(value) {
    const then = new Date(value);
    if (Number.isNaN(then.getTime())) return '';

    const seconds = Math.round((Date.now() - then.getTime()) / 1000);
    const past = seconds >= 0;
    const abs = Math.abs(seconds);

    const units = [
        [60, 'second'], [3600, 'minute'], [86400, 'hour'],
        [604800, 'day'], [2629800, 'week'], [31557600, 'month']
    ];

    if (abs < 45) return past ? 'just now' : 'in a moment';

    for (let i = 0; i < units.length; i += 1) {
        const [limit, unit] = units[i];
        if (abs < limit) {
            const divisor = i === 0 ? 1 : units[i - 1][0];
            const count = Math.round(abs / divisor);
            const plural = count === 1 ? unit : `${unit}s`;
            return past ? `${count} ${plural} ago` : `in ${count} ${plural}`;
        }
    }
    const years = Math.round(abs / 31557600);
    return past ? `${years} year${years === 1 ? '' : 's'} ago` : `in ${years} year${years === 1 ? '' : 's'}`;
}

export function ageFrom(dob) {
    if (!dob) return null;
    const birth = parseDate(dob);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age -= 1;
    return age >= 0 ? age : null;
}
