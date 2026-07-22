/**
 * Charts.
 *
 * Hand-rolled SVG rather than a charting library, for three reasons: the app
 * must work offline from a cold cache, GitHub Pages has no build step to tree-
 * shake a 200KB dependency, and this ERP needs five chart types, not fifty.
 *
 * Everything returns an SVG string. Colours come from the token palette via CSS
 * variables, so charts follow the theme without being re-rendered.
 *
 * Accessibility: each chart carries role="img" and a generated summary in
 * aria-label, plus an optional data table for screen readers. A chart nobody
 * can read is decoration.
 */

import { escapeHtml, html } from '../utils/dom.js';

const PALETTE = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)'];

/**
 * Sparkline. Trend shape only — no axes, no labels. Sits inside a KPI card
 * where the number is the message and the line is the context.
 */
export function sparkline(values, { width = 240, height = 34, tone = 'accent', showLast = true } = {}) {
    const data = values.filter((v) => Number.isFinite(v));
    if (data.length < 2) return '';

    const min = Math.min(...data);
    const max = Math.max(...data);
    const span = max - min || 1;
    const pad = 3;

    const points = data.map((value, index) => {
        const x = (index / (data.length - 1)) * (width - pad * 2) + pad;
        const y = height - pad - ((value - min) / span) * (height - pad * 2);
        return [x, y];
    });

    const line = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    const area = `${line} L${points[points.length - 1][0].toFixed(1)} ${height} L${points[0][0].toFixed(1)} ${height} Z`;

    const stroke = tone === 'accent' ? 'var(--accent)'
        : tone === 'success' ? 'var(--success-500)'
        : tone === 'danger' ? 'var(--danger-500)'
        : 'var(--chart-1)';

    const gradientId = `spark-${Math.random().toString(36).slice(2, 8)}`;
    const [lastX, lastY] = points[points.length - 1];
    const direction = data[data.length - 1] >= data[0] ? 'rising' : 'falling';

    return `<svg class="chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none"
                 role="img" aria-label="Trend over ${data.length} periods, ${direction}">
        <defs>
            <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="${stroke}" stop-opacity="0.18"/>
                <stop offset="100%" stop-color="${stroke}" stop-opacity="0"/>
            </linearGradient>
        </defs>
        <path d="${area}" fill="url(#${gradientId})"/>
        <path d="${line}" fill="none" stroke="${stroke}" stroke-width="1.8"
              stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
        ${showLast ? `<circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="2.4" fill="${stroke}"/>` : ''}
    </svg>`;
}

/**
 * Vertical bars with a value axis. Used for monthly collection and attendance.
 * `formatValue` keeps currency formatting out of this module.
 */
export function barChart(series, {
    height = 220,
    formatValue = (v) => String(v),
    showGrid = true,
    highlightLast = true,
    title = 'Bar chart'
} = {}) {
    if (!series.length) return emptyChart(height);

    const width = 640;
    const padLeft = 52;
    const padRight = 8;
    const padTop = 12;
    const padBottom = 28;

    const plotWidth = width - padLeft - padRight;
    const plotHeight = height - padTop - padBottom;

    const max = Math.max(...series.map((d) => d.value), 1);
    const ticks = niceTicks(max, 4);
    const ceiling = ticks[ticks.length - 1];

    const slot = plotWidth / series.length;
    const barWidth = Math.min(slot * 0.6, 44);

    const gridLines = showGrid ? ticks.map((tick) => {
        const y = padTop + plotHeight - (tick / ceiling) * plotHeight;
        return `<line class="chart-grid-line" x1="${padLeft}" y1="${y.toFixed(1)}" x2="${width - padRight}" y2="${y.toFixed(1)}"/>
                <text class="chart-axis-label" x="${padLeft - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end">${escapeHtml(formatValue(tick))}</text>`;
    }).join('') : '';

    const bars = series.map((point, index) => {
        const barHeight = Math.max((point.value / ceiling) * plotHeight, point.value > 0 ? 2 : 0);
        const x = padLeft + slot * index + (slot - barWidth) / 2;
        const y = padTop + plotHeight - barHeight;
        const isLast = highlightLast && index === series.length - 1;
        const fill = point.color || (isLast ? 'var(--accent)' : 'var(--chart-1)');
        const opacity = isLast || !highlightLast ? 1 : 0.55;

        return `<g class="chart-bar">
            <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}"
                  rx="3" fill="${fill}" opacity="${opacity}">
                <title>${escapeHtml(point.label)}: ${escapeHtml(formatValue(point.value))}</title>
            </rect>
            <text class="chart-axis-label" x="${(x + barWidth / 2).toFixed(1)}" y="${height - 9}" text-anchor="middle">${escapeHtml(point.label)}</text>
        </g>`;
    }).join('');

    const summary = series.map((p) => `${p.label}: ${formatValue(p.value)}`).join(', ');

    return `<svg class="chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet"
                 role="img" aria-label="${escapeHtml(title)}. ${escapeHtml(summary)}">
        ${gridLines}
        ${bars}
        <line class="chart-grid-line" x1="${padLeft}" y1="${padTop + plotHeight}" x2="${width - padRight}" y2="${padTop + plotHeight}"/>
    </svg>`;
}

/**
 * Multi-series line chart. Used for attendance rate and collection trend where
 * two quantities need comparing over the same months.
 */
export function lineChart(series, labels, {
    height = 220,
    formatValue = (v) => String(v),
    title = 'Line chart',
    yMax = null
} = {}) {
    if (!series.length || !labels.length) return emptyChart(height);

    const width = 640;
    const padLeft = 52;
    const padRight = 12;
    const padTop = 12;
    const padBottom = 28;
    const plotWidth = width - padLeft - padRight;
    const plotHeight = height - padTop - padBottom;

    const allValues = series.flatMap((s) => s.values).filter(Number.isFinite);
    const max = yMax ?? Math.max(...allValues, 1);
    const ticks = niceTicks(max, 4);
    const ceiling = ticks[ticks.length - 1];

    const xFor = (index) => padLeft + (labels.length === 1 ? plotWidth / 2 : (index / (labels.length - 1)) * plotWidth);
    const yFor = (value) => padTop + plotHeight - (value / ceiling) * plotHeight;

    const grid = ticks.map((tick) => {
        const y = yFor(tick);
        return `<line class="chart-grid-line" x1="${padLeft}" y1="${y.toFixed(1)}" x2="${width - padRight}" y2="${y.toFixed(1)}"/>
                <text class="chart-axis-label" x="${padLeft - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end">${escapeHtml(formatValue(tick))}</text>`;
    }).join('');

    const lines = series.map((s, seriesIndex) => {
        const colour = s.color || PALETTE[seriesIndex % PALETTE.length];
        const path = s.values
            .map((value, index) => `${index ? 'L' : 'M'}${xFor(index).toFixed(1)} ${yFor(value).toFixed(1)}`)
            .join(' ');

        const dots = s.values.map((value, index) =>
            `<circle cx="${xFor(index).toFixed(1)}" cy="${yFor(value).toFixed(1)}" r="3" fill="${colour}">
                <title>${escapeHtml(s.name)} — ${escapeHtml(labels[index])}: ${escapeHtml(formatValue(value))}</title>
            </circle>`).join('');

        return `<path d="${path}" fill="none" stroke="${colour}" stroke-width="2"
                      stroke-linecap="round" stroke-linejoin="round"/>${dots}`;
    }).join('');

    const xLabels = labels.map((label, index) =>
        `<text class="chart-axis-label" x="${xFor(index).toFixed(1)}" y="${height - 9}" text-anchor="middle">${escapeHtml(label)}</text>`
    ).join('');

    const summary = series.map((s) => `${s.name}: ${s.values.map(formatValue).join(', ')}`).join('. ');

    return `<svg class="chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet"
                 role="img" aria-label="${escapeHtml(title)}. ${escapeHtml(summary)}">
        ${grid}${lines}${xLabels}
        <line class="chart-grid-line" x1="${padLeft}" y1="${padTop + plotHeight}" x2="${width - padRight}" y2="${padTop + plotHeight}"/>
    </svg>`;
}

/**
 * Donut. Reserved for genuine part-to-whole with few slices — fee status
 * (paid / partial / overdue), attendance breakdown. Not for rankings, which
 * belong in a bar chart.
 */
export function donutChart(slices, { size = 168, thickness = 22, centreValue = '', centreLabel = '', title = 'Breakdown' } = {}) {
    const total = slices.reduce((sum, s) => sum + s.value, 0);
    if (!total) return emptyChart(size);

    const radius = (size - thickness) / 2;
    const circumference = 2 * Math.PI * radius;
    const centre = size / 2;

    let offset = 0;
    const arcs = slices.filter((s) => s.value > 0).map((slice, index) => {
        const fraction = slice.value / total;
        const dash = fraction * circumference;
        const colour = slice.color || PALETTE[index % PALETTE.length];
        const element = `<circle cx="${centre}" cy="${centre}" r="${radius}" fill="none"
            stroke="${colour}" stroke-width="${thickness}"
            stroke-dasharray="${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}"
            stroke-dashoffset="${(-offset).toFixed(2)}"
            transform="rotate(-90 ${centre} ${centre})">
            <title>${escapeHtml(slice.label)}: ${slice.value} (${Math.round(fraction * 100)}%)</title>
        </circle>`;
        offset += dash;
        return element;
    }).join('');

    const summary = slices.map((s) => `${s.label} ${Math.round((s.value / total) * 100)}%`).join(', ');

    return `<svg class="chart" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"
                 role="img" aria-label="${escapeHtml(title)}: ${escapeHtml(summary)}">
        <circle cx="${centre}" cy="${centre}" r="${radius}" fill="none"
                stroke="var(--surface-sunken)" stroke-width="${thickness}"/>
        ${arcs}
        ${centreValue ? `<text x="${centre}" y="${centre - 2}" text-anchor="middle"
            font-size="20" font-weight="600" fill="var(--text-primary)"
            font-family="var(--font-ui)">${escapeHtml(centreValue)}</text>` : ''}
        ${centreLabel ? `<text x="${centre}" y="${centre + 15}" text-anchor="middle"
            font-size="10" fill="var(--text-tertiary)"
            font-family="var(--font-ui)">${escapeHtml(centreLabel)}</text>` : ''}
    </svg>`;
}

/** Single-metric ring, e.g. today's attendance rate. */
export function progressRing(percent, { size = 72, thickness = 7, tone = 'accent', label = '' } = {}) {
    const value = Math.max(0, Math.min(100, Number(percent) || 0));
    const radius = (size - thickness) / 2;
    const circumference = 2 * Math.PI * radius;
    const centre = size / 2;
    const dash = (value / 100) * circumference;

    const colour = tone === 'success' ? 'var(--success-500)'
        : tone === 'warning' ? 'var(--warning-500)'
        : tone === 'danger' ? 'var(--danger-500)'
        : 'var(--accent)';

    return `<svg class="chart" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"
                 role="img" aria-label="${escapeHtml(label || 'Progress')}: ${Math.round(value)} percent">
        <circle cx="${centre}" cy="${centre}" r="${radius}" fill="none"
                stroke="var(--surface-sunken)" stroke-width="${thickness}"/>
        <circle cx="${centre}" cy="${centre}" r="${radius}" fill="none"
                stroke="${colour}" stroke-width="${thickness}" stroke-linecap="round"
                stroke-dasharray="${dash.toFixed(2)} ${circumference.toFixed(2)}"
                transform="rotate(-90 ${centre} ${centre})"/>
        <text x="${centre}" y="${centre + 5}" text-anchor="middle" font-size="15" font-weight="600"
              fill="var(--text-primary)" font-family="var(--font-ui)">${Math.round(value)}%</text>
    </svg>`;
}

export function legend(items) {
    return `<div class="chart-legend">${items.map((item, index) => `
        <span class="chart-legend-item">
            <span class="chart-legend-swatch" style="background:${item.color || PALETTE[index % PALETTE.length]}"></span>
            ${escapeHtml(item.label)}
        </span>`).join('')}</div>`;
}

function emptyChart(height) {
    return `<div class="empty empty-compact" style="min-height:${height}px;justify-content:center">
        <p class="empty-text">No data for this period yet.</p>
    </div>`;
}

/** Axis ticks at 1/2/5 × 10ⁿ, so labels read as round numbers. */
function niceTicks(max, count = 4) {
    const rough = max / count;
    const magnitude = 10 ** Math.floor(Math.log10(rough || 1));
    const normalised = rough / magnitude;
    const step = (normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10) * magnitude;

    const ticks = [];
    for (let value = 0; value <= max + step * 0.001; value += step) ticks.push(Math.round(value));
    if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
    return ticks;
}

export { PALETTE as chartPalette };

/* ==========================================================================
   KPI CARD
   --------------------------------------------------------------------------
   The headline-figure card. This lived as a private `kpi` helper in seven
   pages and as `stat` or `miniStat` in three more — ten copies of the same
   nine lines, which had already drifted: three of them silently ignored the
   tone argument because they were copied from the version written before
   tones existed.
   ========================================================================== */

/**
 * @param {string} label   What the number is.
 * @param {*}      value   The number, already formatted.
 * @param {string} [foot]  A short line underneath — a comparison or a caveat.
 * @param {object} [options]
 * @param {'neutral'|'positive'|'negative'|'caution'} [options.tone]
 * @param {boolean} [options.costume]  Gold edge, for headline figures only.
 */
export function kpiCard(label, value, foot = null, { tone = 'neutral', costume = false } = {}) {
    return html`
        <div class="kpi ${costume ? 'kpi-costume' : 'kpi-quiet'}" data-tone="${tone}">
            <div class="kpi-head"><span class="kpi-label">${label}</span></div>
            <div class="kpi-value">${value}</div>
            ${foot ? html`<div class="kpi-foot">${foot}</div>` : ''}
        </div>
    `;
}
