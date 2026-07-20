/**
 * NATYAM ERP 2.0 — CSV
 *
 * Row-object CSV, extracted the moment a second module needed it. The report
 * service builds CSV from its own column definitions; this is for the simpler
 * case of "here are objects, give me a file", which the list pages all want.
 *
 * Excel on a Windows machine — which is what this school has — will not detect
 * UTF-8 without a byte-order mark, and a Telugu name silently becoming mojibake
 * in a contact sheet is the kind of bug nobody reports and everybody works
 * around. So the BOM is written.
 */

import { downloadFile } from './dom.js';

const BOM = '\uFEFF';

export function toCSV(rows, headers = null) {
    if (!rows.length) return '';
    const columns = headers || Object.keys(rows[0]);
    return [
        columns.join(','),
        ...rows.map((row) => columns.map((column) => escapeCell(row[column])).join(','))
    ].join('\r\n');
}

export function downloadCSV(filename, rows, headers = null) {
    const body = toCSV(rows, headers);
    downloadFile(filename.endsWith('.csv') ? filename : `${filename}.csv`, BOM + body, 'text/csv;charset=utf-8');
    return rows.length;
}

function escapeCell(value) {
    if (value === null || value === undefined) return '';
    const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
