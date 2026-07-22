/**
 * NATYAM ERP 2.0 — Certificates
 *
 * A certificate is the only thing this system produces that a family frames
 * and keeps for thirty years. So two things matter more than convenience: the
 * serial must be unique and traceable, and an override must be visible.
 *
 * The service enforces both — serials come from an atomic counter, and issuing
 * against a failed eligibility check demands a reason that is stored on the
 * certificate itself rather than buried in a log. This page's job is to show
 * the failed checks honestly rather than presenting a disabled button with no
 * explanation, which is how people end up keeping a parallel record.
 */

import { Page } from '../../core/router.js';
import { html, render, raw, on } from '../../utils/dom.js';
import { icon } from '../../ui/icons.js';
import { kpiCard } from '../../ui/chart.js';
import { toast } from '../../ui/toast.js';
import { drawer } from '../../ui/overlay.js';
import { DataTable } from '../../ui/table.js';
import { formOverlay, optionsFrom, summaryList } from '../../ui/form.js';
import { session } from '../../core/session.js';
import { EVENTS } from '../../core/bus.js';
import { router } from '../../core/router.js';
import { formatNumber } from '../../utils/money.js';
import { formatDate, formatDateLong, localDate } from '../../utils/date.js';

import {
    TEMPLATES, checkEligibility, issue, revoke, verify,
    listCertificates, printData, certificateSummary
} from '../../services/certificates.service.js';
import { listStudents } from '../../services/students.service.js';
import { listPrograms } from '../../services/programs.service.js';

export default class CertificatesPage extends Page {
    constructor(context) {
        super(context);
        this.title = 'Certificates';
        this.filters = { templateId: this.query.template || '', status: this.query.status || '' };
    }

    async render(container) {
        this.container = container;
        render(container, this.shell());
        this.bind();
        this.buildTable();
        await this.load();

        // Deep link from the student profile.
        if (this.query.student && this.query.issue) {
            await this.issueCertificate(this.query.student);
        }
    }

    shell() {
        return html`
            <header class="page-header">
                <div class="page-header-text">
                    <h1 class="page-title">Certificates</h1>
                    <p class="page-subtitle" data-role="subtitle">Issued, revoked and verifiable.</p>
                </div>
                <div class="page-actions">
                    <button class="btn btn-secondary btn-sm" data-action="verify">
                        ${raw(icon('search', { size: 15 }))} Verify a serial
                    </button>
                    ${session.can('certificate.issue') ? html`
                        <button class="btn btn-primary btn-sm" data-action="issue">
                            ${raw(icon('award', { size: 15 }))} Issue
                        </button>
                    ` : ''}
                </div>
            </header>
            <div class="page-body">
                <div data-role="summary"></div>
                <div class="filter-bar">
                    <label class="filter-control">
                        <span class="sr-only">Template</span>
                        <select class="select select-sm" data-filter="templateId">
                            <option value="">All kinds</option>
                            ${TEMPLATES.map((template) => html`
                                <option value="${template.id}"
                                        ${this.filters.templateId === template.id ? 'selected' : ''}>
                                    ${template.name}
                                </option>
                            `)}
                        </select>
                    </label>
                    <label class="filter-control">
                        <span class="sr-only">Status</span>
                        <select class="select select-sm" data-filter="status">
                            <option value="">All statuses</option>
                            <option value="issued" ${this.filters.status === 'issued' ? 'selected' : ''}>Issued</option>
                            <option value="revoked" ${this.filters.status === 'revoked' ? 'selected' : ''}>Revoked</option>
                        </select>
                    </label>
                </div>
                <div data-role="table"></div>
            </div>
        `;
    }

    bind() {
        this.onDispose(on(this.container, 'click', '[data-action="issue"]', () => this.issueCertificate()));
        this.onDispose(on(this.container, 'click', '[data-action="verify"]', () => this.verifySerial()));
        this.onDispose(on(this.container, 'change', '[data-filter]', (_e, target) => {
            this.filters[target.dataset.filter] = target.value;
            this.load();
        }));

        [EVENTS.CERTIFICATE_ISSUED, EVENTS.BRANCH_CHANGED]
            .filter(Boolean)
            .forEach((event) => this.events.on(event, () => this.load()));
    }

    buildTable() {
        this.table = new DataTable({
            rows: [],
            searchPlaceholder: 'Search serial, student or kind…',
            defaultSort: 'issuedOn',
            defaultSortDir: 'desc',
            emptyTitle: 'No certificates issued',
            emptyMessage: 'Level completions and participation certificates appear here once issued.',
            emptyIcon: 'award',
            emptyAction: session.can('certificate.issue')
                ? { label: 'Issue one', onClick: () => this.issueCertificate() }
                : null,
            onRowClick: (row) => this.openCertificate(row),
            columns: [
                {
                    key: 'serial', label: 'Serial', sortable: true,
                    searchValue: (row) => `${row.serial} ${row.studentName || ''} ${row.templateName}`,
                    render: (row) => html`
                        <div>
                            <span class="type-strong">${row.serial}</span>
                            <div class="type-caption type-muted">${row.templateName}</div>
                        </div>
                    `
                },
                {
                    key: 'studentName', label: 'Student', sortable: true,
                    render: (row) => row.studentName || html`<span class="type-muted">—</span>`
                },
                { key: 'levelLabel', label: 'Level', sortable: true },
                {
                    key: 'issuedOn', label: 'Issued', sortable: true,
                    render: (row) => formatDate(row.issuedOn)
                },
                {
                    key: 'status', label: 'Status', sortable: true,
                    render: (row) => html`
                        <div class="row row-tight">
                            <span class="badge ${row.status === 'revoked' ? 'badge-danger' : 'badge-success'}">
                                ${row.status || 'issued'}
                            </span>
                            ${row.overridden ? html`<span class="badge badge-warning">override</span>` : ''}
                        </div>
                    `
                }
            ]
        });

        this.table.mount(this.container.querySelector('[data-role="table"]'));
        this.onDispose(() => this.table.destroy());
    }

    async load() {
        try {
            const [rows, stats] = await Promise.all([
                listCertificates({
                    branchId: session.branch(),
                    templateId: this.filters.templateId || null,
                    status: this.filters.status || null
                }),
                certificateSummary(session.branch())
            ]);

            this.rows = rows;
            this.table.setRows(rows);

            render(this.container.querySelector('[data-role="subtitle"]'), html`
                ${formatNumber(stats.total)} issued in total · ${formatNumber(stats.thisYear)} this academic year
            `);

            render(this.container.querySelector('[data-role="summary"]'), html`
                <div class="grid grid-4">
                    ${kpiCard('Issued', formatNumber(stats.total))}
                    ${kpiCard('This year', formatNumber(stats.thisYear))}
                    ${kpiCard('Overridden', formatNumber(stats.overridden),
                        stats.overridden ? 'issued despite a failed check' : 'none', { tone: stats.overridden ? 'caution' : 'positive' })}
                    ${kpiCard('Revoked', formatNumber(stats.revoked), null, { tone: stats.revoked ? 'negative' : 'positive' })}
                </div>
            `);
        } catch (err) {
            console.error(err);
            toast.error(err.message);
        }
    }

    /* ----------------------------------------------------------------- ISSUE */

    async issueCertificate(studentId = null) {
        session.require('certificate.issue', 'issue a certificate');

        const [students, programs] = await Promise.all([
            listStudents(session.branch(), { status: 'all', withFees: false }),
            listPrograms(session.branch())
        ]);

        const result = await formOverlay({
            title: 'Issue a certificate',
            description: 'Eligibility is checked before it is issued.',
            submitLabel: 'Check and issue',
            fields: [
                {
                    name: 'studentId', label: 'Student', type: 'select', required: true, value: studentId,
                    options: optionsFrom(students, {
                        label: (s) => s.name,
                        note: (s) => `${s.levelLabel}${s.batchName ? ` · ${s.batchName}` : ''}`
                    })
                },
                {
                    name: 'templateId', label: 'Kind', type: 'select', required: true,
                    options: TEMPLATES.map((template) => ({ value: template.id, label: template.name }))
                },
                {
                    name: 'programId', label: 'Programme', type: 'select',
                    placeholder: 'Not linked to a programme',
                    options: optionsFrom(programs, {
                        label: (p) => p.name, note: (p) => formatDate(p.date)
                    }),
                    hint: 'Required for a participation certificate.'
                },
                { name: 'citation', label: 'Citation', type: 'textarea', rows: 2,
                  hint: 'Required for a merit award — what is being recognised.' },
                { name: 'issuedOn', label: 'Issue date', type: 'date', value: localDate(), width: 'half' }
            ],
            onSubmit: async (values) => this.attemptIssue(values)
        });

        if (!result) return;

        toast.success(`Certificate ${result.serial} issued.`);
        await this.load();
        await this.printCertificate(result.id);
    }

    /**
     * Issue, and if the service refuses, show exactly why and offer an
     * override with a reason. Silently disabling the button would leave the
     * office with no way to handle the student who was genuinely ill for a
     * term, and they would go back to writing certificates by hand.
     */
    async attemptIssue(values) {
        try {
            return await issue(values);
        } catch (err) {
            const reasons = err.reasons || [err.message];

            const override = await formOverlay({
                title: 'This student does not meet the requirements',
                variant: 'modal',
                submitLabel: 'Issue anyway',
                danger: true,
                intro: reasons.join(' '),
                fields: [{
                    name: 'overrideReason', label: 'Reason for the override', type: 'textarea',
                    rows: 3, required: true,
                    hint: 'Stored on the certificate itself, not just the audit log. It will always be visible.'
                }],
                onSubmit: async (v) => issue({ ...values, force: true, overrideReason: v.overrideReason })
            });

            return override || { errors: {} };
        }
    }

    /* ---------------------------------------------------------------- DETAIL */

    async openCertificate(row) {
        await drawer({
            title: row.serial,
            description: `${row.templateName} · ${row.studentName || ''}`,
            size: 'md',
            content: html`
                ${row.status === 'revoked' ? html`
                    <div class="alert alert-danger">
                        <div class="alert-title">Revoked</div>
                        <p class="alert-body">${row.revocationReason || 'No reason recorded.'}</p>
                    </div>
                ` : ''}

                ${row.overridden ? html`
                    <div class="alert alert-warning">
                        <div class="alert-title">Issued as an override</div>
                        <p class="alert-body">${row.overrideReason}</p>
                    </div>
                ` : ''}

                <div class="card"><div class="card-body">
                    ${summaryList([
                        ['Serial', row.serial],
                        ['Kind', row.templateName],
                        ['Student', row.studentName],
                        ['Level', row.levelLabel],
                        ['Issued', row.issuedOn ? formatDateLong(row.issuedOn) : null],
                        ['Issued by', row.issuedByName],
                        ['Academic year', row.academicYear],
                        ['Citation', row.citation],
                        ['Title', row.title]
                    ])}
                </div></div>

                ${row.body ? html`
                    <div class="card">
                        <div class="card-header"><h3 class="card-title">Wording</h3></div>
                        <div class="card-body"><p class="type-body">${row.body}</p></div>
                    </div>
                ` : ''}
            `,
            actions: [
                { label: 'Close', variant: 'secondary', value: null },
                ...(row.status !== 'revoked' && session.can('certificate.issue') ? [{
                    label: 'Revoke',
                    variant: 'danger-quiet',
                    onClick: async () => { await this.revokeCertificate(row); return null; }
                }] : []),
                {
                    label: 'Print',
                    variant: 'primary',
                    primary: true,
                    onClick: async () => { await this.printCertificate(row.id); return null; }
                }
            ],
            onMount: (body, api) => {
                on(body, 'click', '[data-student]', (_e, target) => {
                    api.close(null);
                    router.go(`/students?student=${target.dataset.student}`);
                });
            }
        });
    }

    async revokeCertificate(row) {
        const done = await formOverlay({
            title: `Revoke ${row.serial}?`,
            variant: 'modal',
            size: 'sm',
            submitLabel: 'Revoke certificate',
            danger: true,
            intro: 'The certificate stays on the record marked as revoked. A copy already in the family\u2019s hands '
                + 'cannot be recalled — this only makes the school\u2019s position clear.',
            fields: [{ name: 'reason', label: 'Reason', type: 'textarea', rows: 3, required: true }],
            onSubmit: async (values) => revoke(row.id, { reason: values.reason })
        });

        if (done) {
            toast.success('Certificate revoked.');
            await this.load();
        }
    }

    /* ---------------------------------------------------------------- VERIFY */

    async verifySerial() {
        await formOverlay({
            title: 'Verify a certificate',
            variant: 'modal',
            size: 'sm',
            submitLabel: 'Check',
            intro: 'Enter the serial printed on the certificate.',
            fields: [{ name: 'serial', label: 'Serial', required: true, placeholder: 'NAT/CRT/26/0031' }],
            onSubmit: async (values, helpers) => {
                const found = await verify(values.serial.trim());

                if (!found) {
                    helpers.banner('No certificate carries that serial. It was not issued by this school.');
                    return false;
                }

                helpers.banner(
                    found.status === 'revoked'
                        ? `Genuine, but revoked — ${found.studentName}, ${found.templateName}. ${found.revocationReason || ''}`
                        : `Genuine — ${found.studentName}, ${found.templateName}, issued ${formatDateLong(found.issuedOn)}.`
                );
                return false;
            }
        });
    }

    /* ----------------------------------------------------------------- PRINT */

    async printCertificate(id) {
        try {
            const data = await printData(id);
            const win = window.open('', '_blank', 'width=1000,height=760');
            if (!win) {
                toast.error('Allow pop-ups to print the certificate.');
                return;
            }
            win.document.write(certificateHTML(data));
            win.document.close();
            win.focus();
        } catch (err) {
            toast.error(err.message);
        }
    }
}


/**
 * Landscape A4, self-contained. The certificate does not use the app's
 * stylesheet for the same reason the receipt does not: it must render
 * identically from any tab, on any day, forever.
 */
function certificateHTML(data) {
    const { certificate, student, institute, signatory, verifyHint } = data;
    const school = institute?.name || 'NATYAM — School of Kuchipudi';

    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(certificate.serial)}</title>
<style>
  @page { size: A4 landscape; margin: 0; }
  body { margin: 0; font: 15px/1.7 "Segoe UI", system-ui, sans-serif; color: #241c17; }
  .sheet {
    width: 297mm; height: 210mm; box-sizing: border-box; padding: 22mm 26mm;
    display: flex; flex-direction: column; align-items: center; text-align: center;
    background: #fdfbf7; position: relative;
  }
  .sheet::before {
    content: ""; position: absolute; inset: 10mm;
    border: 2px solid #c9a227; outline: 1px solid #c9a227; outline-offset: 3mm;
  }
  .inner { position: relative; display: flex; flex-direction: column; height: 100%; width: 100%; }
  .school { font-size: 13px; letter-spacing: .26em; text-transform: uppercase; color: #7a6a58; }
  h1 { font-size: 30px; margin: 14mm 0 2mm; letter-spacing: .04em; font-weight: 600; }
  .rule { width: 60mm; height: 2px; background: #b8562f; margin: 0 auto 10mm; }
  .body { font-size: 16px; max-width: 200mm; margin: 0 auto; line-height: 2; }
  .name { font-size: 26px; margin: 6mm 0; font-weight: 600; letter-spacing: .02em; }
  .citation { font-style: italic; color: #4a4038; margin-top: 6mm; }
  .foot { margin-top: auto; display: flex; justify-content: space-between; align-items: flex-end;
          width: 100%; font-size: 12px; color: #5a5048; }
  .sign { border-top: 1px solid #241c17; padding-top: 2mm; min-width: 55mm; }
  .serial { letter-spacing: .1em; }
  @media screen { body { background: #4a4038; padding: 20px; } .sheet { margin: 0 auto; box-shadow: 0 12px 40px rgba(0,0,0,.35); } }
</style></head><body>
  <div class="sheet"><div class="inner">
    <div class="school">${esc(school)}</div>
    <h1>${esc(certificate.title)}</h1>
    <div class="rule"></div>
    <div class="name">${esc(student?.name || '')}</div>
    <div class="body">${esc(certificate.body || '')}</div>
    ${certificate.citation ? `<div class="citation">${esc(certificate.citation)}</div>` : ''}
    <div class="foot">
      <div>
        <div class="serial">${esc(certificate.serial)}</div>
        <div>${esc(formatDateLong(certificate.issuedOn))}</div>
      </div>
      <div class="sign">${esc(signatory?.name || 'Principal')}</div>
    </div>
  </div></div>
  <script>window.print();<\/script>
</body></html>`;
}

function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}
