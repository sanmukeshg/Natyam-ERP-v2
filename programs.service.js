/**
 * Icons.
 *
 * Inline SVG paths rather than an icon font or a sprite file. Fonts render
 * boxes if the file is missing offline and are invisible to a screen reader in
 * ways that are hard to fix; a sprite is an extra request that can fail on a
 * cold cache. Inline paths always paint, inherit `currentColor`, and cost about
 * 4KB for the whole set.
 *
 * 1.0 used emoji in the sidebar. Emoji render differently on every OS, cannot
 * be recoloured, and are announced literally by screen readers ("house with
 * garden" for the dashboard link).
 */

const PATHS = {
    /* Navigation */
    home:          '<path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1V9.5Z"/>',
    inbox:         '<path d="M4 13h4l1.5 3h5L16 13h4"/><path d="M4 13 6 5h12l2 8v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-6Z"/>',
    users:         '<circle cx="9" cy="8" r="3.2"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16.5 5.6a3.2 3.2 0 0 1 0 6.2"/><path d="M18 14.4a6.2 6.2 0 0 1 3.5 5.6"/>',
    briefcase:     '<rect x="2.5" y="7" width="19" height="13" rx="2"/><path d="M8.5 7V5a1.5 1.5 0 0 1 1.5-1.5h4A1.5 1.5 0 0 1 15.5 5v2"/><path d="M2.5 12.5h19"/>',
    grid:          '<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>',
    'check-square':'<rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="m8 12 2.8 2.8L16.5 9"/>',
    star:          '<path d="m12 3.2 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3.2Z"/>',
    award:         '<circle cx="12" cy="9" r="5.5"/><path d="m8.5 13.8-1.4 6.7 4.9-2.6 4.9 2.6-1.4-6.7"/>',
    receipt:       '<path d="M5 3.5h14v17l-2.3-1.6-2.4 1.6-2.3-1.6L9.7 20.5 7.3 18.9 5 20.5v-17Z"/><path d="M8.5 8h7M8.5 12h7"/>',
    layers:        '<path d="m12 3 9 4.8-9 4.8-9-4.8L12 3Z"/><path d="m3 12.5 9 4.8 9-4.8"/><path d="m3 17 9 4.8L21 17"/>',
    'trending-up': '<path d="m3 16.5 5.5-5.5 3.5 3.5L21 5.5"/><path d="M15.5 5.5H21v5.5"/>',
    'bar-chart':   '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    settings:      '<circle cx="12" cy="12" r="3"/><path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H2a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H8a1.6 1.6 0 0 0 1-1.5V2a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V8a1.6 1.6 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"/>',

    /* Actions */
    search:        '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.9-3.9"/>',
    plus:          '<path d="M12 5v14M5 12h14"/>',
    minus:         '<path d="M5 12h14"/>',
    x:             '<path d="M18 6 6 18M6 6l12 12"/>',
    check:         '<path d="m20 6-11 11-5-5"/>',
    edit:          '<path d="M17 3.5a2.1 2.1 0 0 1 3 3L7.5 19 3 20.5 4.5 16 17 3.5Z"/>',
    trash:         '<path d="M3 6h18M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6M19 6v13.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5V6"/><path d="M10 11v6M14 11v6"/>',
    download:      '<path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/>',
    upload:        '<path d="M12 20V8"/><path d="m7 12 5-5 5 5"/><path d="M4 4h16"/>',
    printer:       '<path d="M7 8V3h10v5"/><rect x="3" y="8" width="18" height="8" rx="2"/><path d="M7 14h10v7H7v-7Z"/>',
    filter:        '<path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z"/>',
    'more-vertical':'<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>',
    refresh:       '<path d="M20.5 11a8.5 8.5 0 1 0-1.6 6"/><path d="M20.5 17v-5h-5"/>',
    copy:          '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    'external-link':'<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V8a1.5 1.5 0 0 1 1.5-1.5H10"/>',

    /* Chevrons and arrows */
    'chevron-down':  '<path d="m5 9 7 7 7-7"/>',
    'chevron-up':    '<path d="m5 15 7-7 7 7"/>',
    'chevron-left':  '<path d="m15 5-7 7 7 7"/>',
    'chevron-right': '<path d="m9 5 7 7-7 7"/>',
    'chevrons-left': '<path d="m11 5-7 7 7 7M19 5l-7 7 7 7"/>',
    'arrow-up':      '<path d="M12 20V4"/><path d="m5 11 7-7 7 7"/>',
    'arrow-down':    '<path d="M12 4v16"/><path d="m5 13 7 7 7-7"/>',
    'arrow-right':   '<path d="M4 12h16"/><path d="m13 5 7 7-7 7"/>',
    'arrow-left':    '<path d="M20 12H4"/><path d="m11 5-7 7 7 7"/>',
    'corner-down-right':'<path d="M4 4v8a3 3 0 0 0 3 3h12"/><path d="m15 11 4 4-4 4"/>',

    /* Status */
    'check-circle':  '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.6 2.6L16 9"/>',
    'alert-circle':  '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5"/><circle cx="12" cy="16.2" r=".9" fill="currentColor" stroke="none"/>',
    'alert-triangle':'<path d="M10.3 3.9 1.9 18.4A2 2 0 0 0 3.6 21.4h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4.5"/><circle cx="12" cy="17.2" r=".9" fill="currentColor" stroke="none"/>',
    'x-circle':      '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/>',
    info:            '<circle cx="12" cy="12" r="9"/><path d="M12 16.5v-5"/><circle cx="12" cy="8" r=".9" fill="currentColor" stroke="none"/>',
    clock:           '<circle cx="12" cy="12" r="9"/><path d="M12 6.8V12l3.4 2"/>',
    lock:            '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2"/><path d="M8 10.5V7.2a4 4 0 0 1 8 0v3.3"/>',
    bell:            '<path d="M18 8.5a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16s-2-1.5-2-6.5Z"/><path d="M13.7 19a2 2 0 0 1-3.4 0"/>',
    'cloud-off':     '<path d="m3 3 18 18"/><path d="M18.4 15.7A4 4 0 0 0 17 8h-1.3A7 7 0 0 0 7.5 6"/><path d="M5.8 8.3A4.5 4.5 0 0 0 7 17h9"/>',
    compass:         '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z"/>',

    /* Domain */
    calendar:      '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    'calendar-check':'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="m8.5 15 2.2 2.2 4.3-4.3"/>',
    'map-pin':     '<path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/>',
    phone:         '<path d="M6.5 3h3l1.5 4.5-2 1.5a12 12 0 0 0 6 6l1.5-2L21 14.5v3a2 2 0 0 1-2.2 2A17 17 0 0 1 4 5.2 2 2 0 0 1 6.5 3Z"/>',
    mail:          '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    user:          '<circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>',
    'user-plus':   '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M19 8v6M22 11h-6"/>',
    file:          '<path d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5L13.5 3Z"/><path d="M13.5 3v5.5H19"/>',
    'file-text':   '<path d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5L13.5 3Z"/><path d="M13.5 3v5.5H19M8.5 13h7M8.5 17h5"/>',
    activity:      '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    'pie-chart':   '<path d="M21 12A9 9 0 1 1 12 3v9h9Z"/>',
    wallet:        '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18v3"/><rect x="3" y="7.5" width="18" height="12.5" rx="2"/><circle cx="17" cy="14" r="1.3" fill="currentColor" stroke="none"/>',
    moon:          '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z"/>',
    sun:           '<circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.5M12 19.5V22M4.2 4.2 6 6M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8 6 18M18 6l1.8-1.8"/>',
    menu:          '<path d="M4 7h16M4 12h16M4 17h16"/>',
    'log-out':     '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 8l-4 4 4 4M6 12h9"/>',
    database:      '<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    'help-circle': '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.2a2.6 2.6 0 0 1 5 .8c0 1.7-2.5 2.5-2.5 2.5"/><circle cx="12" cy="16.5" r=".9" fill="currentColor" stroke="none"/>',
    'shopping-bag':'<path d="M5 7h14l1 13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1L5 7Z"/><path d="M9 10V6a3 3 0 0 1 6 0v4"/>',
    music:         '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',

    /* Added after a coverage audit found nine call sites drawing nothing:
       a missing icon rendered as an empty span, so the sidebar brand mark and
       several refresh buttons were silently blank. */
    feather:        '<path d="M20.2 3.8a5.5 5.5 0 0 0-7.8 0L4 12.2V20h7.8l8.4-8.4a5.5 5.5 0 0 0 0-7.8Z"/><path d="M16 8 2 22"/><path d="M17.5 11.5h-7"/>',
    'refresh-cw':   '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v5h-5"/>',
    'rotate-ccw':   '<path d="M3 12a9 9 0 1 0 2.6-6.4"/><path d="M3 3v5h5"/>',
    'trending-down':'<path d="m3 7.5 5.5 5.5 3.5-3.5L21 18.5"/><path d="M15.5 18.5H21V13"/>',
    shield:         '<path d="M12 2.5 4.5 5.5v6c0 4.6 3.1 8.8 7.5 10 4.4-1.2 7.5-5.4 7.5-10v-6L12 2.5Z"/>',
    archive:        '<rect x="2.5" y="4" width="19" height="4.5" rx="1"/><path d="M4.5 8.5V19a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V8.5"/><path d="M9.5 12.5h5"/>',
    'user-check':   '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="m16.5 12 2 2 4-4"/>',
    'toggle-left':  '<rect x="2" y="6.5" width="20" height="11" rx="5.5"/><circle cx="7.5" cy="12" r="2.5"/>',
};

/**
 * Renders an icon as an inline SVG string.
 *
 * Icons are decorative by default (`aria-hidden`), because they nearly always
 * sit beside a text label. Pass a `label` only where the icon is the sole
 * content of a control, and in that case prefer an aria-label on the button.
 */
export function icon(name, { size = 20, className = 'icon', label = null, strokeWidth = 1.7 } = {}) {
    const path = PATHS[name];
    if (!path) {
        console.warn(`Unknown icon: ${name}`);
        return '';
    }
    const a11y = label
        ? `role="img" aria-label="${label.replace(/"/g, '&quot;')}"`
        : 'aria-hidden="true" focusable="false"';

    return `<svg class="${className}" width="${size}" height="${size}" viewBox="0 0 24 24" ` +
           `fill="none" stroke="currentColor" stroke-width="${strokeWidth}" ` +
           `stroke-linecap="round" stroke-linejoin="round" ${a11y}>${path}</svg>`;
}

export function hasIcon(name) { return Boolean(PATHS[name]); }
export const iconNames = Object.keys(PATHS);
