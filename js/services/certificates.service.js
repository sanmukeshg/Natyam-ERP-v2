/**
 * NATYAM ERP 2.0 — Certificate service
 *
 * A certificate is the only artefact this system produces that leaves the
 * building and outlives it. A parent will present a Praveshika certificate to
 * a college admissions officer in eleven years' time, and the only thing
 * standing behind it will be a serial number this module minted.
 *
 * That shapes three decisions:
 *
 *  - serials are allocated from the settings counter, never derived from a
 *    row count, so deleting a record can never cause a serial to be reissued;
 *  - a certificate is never hard-deleted, only revoked, and a revoked serial
 *    still verifies — returning "revoked on 12 March, reason: issued in error"
 *    rather than "not found", because "not found" is indistinguishable from a
 *    typo and tells the person holding the paper nothing;
 *  - eligibility is checked and *explained*, so a registrar is told the
 *    student's attendance is 61% rather than simply being refused.
 */

import { bus, EVENTS } from '../core/bus.js';
import { session } from '../core/session.js';
import { db, request } from '../core/db.js';
import { uid } from '../utils/id.js';
import { localDate, nowISO, academicYearOf, formatDateLong, daysBetween } from '../utils/date.js';
import { LEVELS, levelLabel } from '../config/app.config.js';
import {
    certificates$, students$, programs$, staff$, attendance$, settings$, AttendanceMath
} from '../data/repositories.js';
import { notify } from './notifications.service.js';

/* ==========================================================================
   TEMPLATES
   --------------------------------------------------------------------------
   Data, not markup. The template decides what a certificate *says* and what
   must be true before it may be issued; how it looks belongs to the print
   view, and keeping the two apart means the school can restyle its
   certificates without anyone touching the eligibility rules.
   ========================================================================== */

export const TEMPLATES = Object.freeze([
    {
        id: 'level-completion',
        name: 'Level completion',
        title: (ctx) => `Certificate of Completion — ${ctx.levelLabel}`,
        body: (ctx) =>
            `This is to certify that ${ctx.student.name} has successfully completed the ${ctx.levelLabel} level ` +
            `of the Kuchipudi curriculum at NATYAM — School of Kuchipudi, having maintained an attendance of ` +
            `${ctx.attendanceRate}% during the ${ctx.academicYear} academic year.`,
        requires: { minAttendance: 75, minTenureDays: 180, needsLevel: true },
        signatories: ['Principal', 'Guru']
    },
    {
        id: 'participation',
        name: 'Programme participation',
        title: (ctx) => `Certificate of Participation — ${ctx.program?.name || 'Programme'}`,
        body: (ctx) =>
            `This is to certify that ${ctx.student.name} participated in ${ctx.program?.name} ` +
            `held on ${formatDateLong(ctx.program?.date)}${ctx.program?.venue ? ` at ${ctx.program.venue}` : ''}, ` +
            `representing NATYAM — School of Kuchipudi.`,
        requires: { needsProgram: true },
        signatories: ['Principal']
    },
    {
        id: 'merit',
        name: 'Merit award',
        title: () => 'Certificate of Merit',
        body: (ctx) =>
            `Awarded to ${ctx.student.name} in recognition of outstanding dedication and achievement ` +
            `in the study and performance of Kuchipudi${ctx.citation ? `: ${ctx.citation}` : ''}.`,
        requires: { needsCitation: true },
        signatories: ['Principal', 'Guru']
    },
    {
        id: 'diploma',
        name: 'Performance diploma',
        title: () => 'Diploma in Kuchipudi — Alankara',
        body: (ctx) =>
            `This is to certify that ${ctx.student.name} has completed the full course of study at ` +
            `NATYAM — School of Kuchipudi, culminating in the Alankara performance diploma, ` +
            `having trained under the school since ${formatDateLong(ctx.student.joinedOn)}.`,
        requires: { minAttendance: 80, minTenureDays: 1460, onlyLevel: 'alankara' },
        signatories: ['Principal', 'Guru', 'Examiner']
    }
]);

export function template(id) {
    const found = TEMPLATES.find((t) => t.id === id);
    if (!found) throw new Error(`Unknown certificate template "${id}".`);
    return found;
}

/* ==========================================================================
   ELIGIBILITY
   ========================================================================== */

/**
 * Checks whether a certificate may be issued, and says why not when it may
 * not. Returns rather than throws so the UI can grey out a button with a
 * tooltip instead of waiting for a click to produce an error.
 */
export async function checkEligibility({ studentId, templateId, programId = null, citation = null }) {
    const student = await students$.findOrFail(studentId);
    const spec = template(templateId);
    const rules = spec.requires || {};
    const reasons = [];

    const rows = await attendance$.forStudent(studentId);
    const attendanceRate = AttendanceMath.rateOf(rows);
    const tenure = student.joinedOn ? daysBetween(student.joinedOn, localDate()) : 0;

    if (rules.minAttendance !== undefined) {
        if (attendanceRate === null) reasons.push('No attendance has been recorded for this student yet.');
        else if (attendanceRate < rules.minAttendance) {
            reasons.push(`Attendance is ${attendanceRate}%, below the ${rules.minAttendance}% this certificate requires.`);
        }
    }
    if (rules.minTenureDays !== undefined && tenure < rules.minTenureDays) {
        const years = (rules.minTenureDays / 365).toFixed(1).replace(/\.0$/, '');
        reasons.push(`${student.name} has been enrolled ${Math.floor(tenure / 30)} months; this certificate requires ${years} year${years === '1' ? '' : 's'}.`);
    }
    if (rules.onlyLevel && student.level !== rules.onlyLevel) {
        reasons.push(`This certificate is only for students at ${levelLabel(rules.onlyLevel)}. ${student.name} is at ${levelLabel(student.level)}.`);
    }
    if (rules.needsProgram && !programId) {
        reasons.push('Choose the programme this certificate is for.');
    }
    if (rules.needsCitation && !citation?.trim()) {
        reasons.push('A merit award needs a citation describing what is being recognised.');
    }

    const duplicate = (await certificates$.forStudent(studentId)).find((c) =>
        c.templateId === templateId &&
        c.status !== 'revoked' &&
        (!programId || c.programId === programId) &&
        (!rules.needsLevel || c.level === student.level)
    );
    if (duplicate) {
        reasons.push(`${student.name} already holds this certificate (${duplicate.serial}, issued ${formatDateLong(duplicate.issuedOn)}).`);
    }

    return {
        ok: reasons.length === 0,
        reasons,
        context: { student, attendanceRate, tenureDays: tenure, level: student.level }
    };
}

/* ==========================================================================
   ISSUANCE
   ========================================================================== */

/**
 * Issues a certificate.
 *
 * The serial and the row are written in one transaction with the audit entry.
 * `force` exists for the genuine case — a guru overriding an attendance rule
 * for a student who was ill — and demands a reason, which is stored on the
 * certificate itself so the override is visible forever rather than only in a
 * log somebody has to think to check.
 */
export async function issue({ studentId, templateId, programId = null, citation = null, issuedOn = null, force = false, overrideReason = null }) {
    session.require('certificate.issue', 'issue a certificate');

    const eligibility = await checkEligibility({ studentId, templateId, programId, citation });
    if (!eligibility.ok) {
        if (!force) {
            const err = new Error(eligibility.reasons[0]);
            err.reasons = eligibility.reasons;
            throw err;
        }
        if (!overrideReason?.trim()) {
            throw new Error('Overriding the eligibility rules requires a reason. It is recorded on the certificate.');
        }
    }

    const student = eligibility.context.student;
    const spec = template(templateId);
    const program = programId ? await programs$.findOrFail(programId) : null;
    const principal = await settings$.get('institute', {});
    const year = academicYearOf();

    const context = {
        student,
        program,
        citation: citation?.trim() || null,
        levelLabel: levelLabel(student.level),
        attendanceRate: eligibility.context.attendanceRate ?? 0,
        academicYear: `${year.start}–${year.end}`
    };

    const seq = await settings$.nextSequence('certificate');
    const serial = formatSerial(seq, year.start);
    const at = nowISO();
    const actor = session.actorId();

    const certificate = {
        id: uid('CRT'),
        serial,
        templateId,
        studentId: student.id,
        studentName: student.name,
        admissionNo: student.admissionNo,
        programId: program?.id || null,
        programName: program?.name || null,
        branchId: student.branchId,
        level: student.level,
        title: spec.title(context),
        body: spec.body(context),
        citation: context.citation,
        signatories: spec.signatories,
        principal: principal?.principal || null,
        attendanceRate: context.attendanceRate,
        academicYear: context.academicYear,
        issuedOn: issuedOn || localDate(),
        issuedBy: actor,
        issuedByName: session.actorName(),
        status: 'issued',
        overridden: !eligibility.ok,
        overrideReason: eligibility.ok ? null : overrideReason.trim(),
        searchKey: [serial, student.name, spec.name, program?.name].filter(Boolean).join(' ').toLowerCase(),
        createdAt: at, createdBy: actor, updatedAt: at, updatedBy: actor, deletedAt: null
    };

    await db.unit(['certificates', 'auditLog'], async (s) => {
        await request(s.certificates.put(certificate));
        await request(s.auditLog.put({
            id: uid('AUD'), entity: 'Certificate', entityId: certificate.id, action: 'issue',
            detail: { serial, studentId: student.id, templateId, overridden: certificate.overridden },
            actorId: actor, actorName: session.actorName(), at
        }));
    }, 'certificate:issue');

    bus.emit(EVENTS.CERTIFICATE_ISSUED, { certificate });
    return certificate;
}

/**
 * Issues the same certificate to a whole cast at once.
 *
 * Unlike most bulk operations in this codebase this one does *not* fail as a
 * unit. Eighteen students performed; if two of them are short on attendance,
 * refusing all eighteen helps nobody. Each is attempted independently and the
 * failures are reported back by name so the registrar can decide about them
 * individually.
 */
export async function issueBatch({ studentIds, templateId, programId = null, force = false, overrideReason = null }) {
    session.require('certificate.issue', 'issue certificates');

    const issued = [];
    const failed = [];

    for (const studentId of studentIds) {
        try {
            issued.push(await issue({ studentId, templateId, programId, force, overrideReason }));
        } catch (err) {
            const student = await students$.find(studentId);
            failed.push({ studentId, name: student?.name || studentId, reason: err.message });
        }
    }

    if (issued.length) {
        await notify({
            kind: 'certificate',
            key: `certificates:batch:${Date.now()}`,
            title: `${issued.length} certificate${issued.length === 1 ? '' : 's'} issued`,
            body: programId ? (await programs$.find(programId))?.name : template(templateId).name,
            link: '#/certificates'
        });
    }

    return { issued, failed };
}

/**
 * Revokes a certificate. The record and its serial survive; only the status
 * changes, so a revoked certificate presented to a verifier is correctly
 * identified rather than appearing never to have existed.
 */
export async function revoke(id, { reason }) {
    session.require('certificate.issue', 'revoke a certificate');

    if (!reason?.trim()) throw new Error('Revoking a certificate requires a reason. It is shown to anyone who verifies the serial.');

    const certificate = await certificates$.findOrFail(id);
    if (certificate.status === 'revoked') throw new Error('This certificate has already been revoked.');

    const revoked = await certificates$.update(id, {
        status: 'revoked',
        revokedOn: localDate(),
        revokedBy: session.actorId(),
        revokeReason: reason.trim()
    });

    bus.emit(EVENTS.CERTIFICATE_REVOKED, { certificate: revoked });
    return revoked;
}

/* ==========================================================================
   VERIFICATION
   ========================================================================== */

/**
 * Looks up a serial. The public-facing operation: whatever the answer, it is
 * phrased for a person holding a piece of paper, not for a developer.
 */
export async function verify(serial) {
    const cleaned = String(serial || '').trim().toUpperCase();
    if (!cleaned) return { found: false, message: 'Enter a certificate serial number.' };

    const certificate = await certificates$.verify(cleaned);
    if (!certificate) {
        return {
            found: false,
            message: `No certificate with the serial ${cleaned} was issued by this school. Check for transcription errors — the format is NAT/CRT/YY/0000.`
        };
    }

    if (certificate.status === 'revoked') {
        return {
            found: true,
            valid: false,
            certificate,
            message: `This certificate was revoked on ${formatDateLong(certificate.revokedOn)}. Reason recorded: ${certificate.revokeReason}`
        };
    }

    return {
        found: true,
        valid: true,
        certificate,
        message: `Valid. Issued to ${certificate.studentName} on ${formatDateLong(certificate.issuedOn)}.`
    };
}

/* ==========================================================================
   VIEWS
   ========================================================================== */

/** The certificate register. */
export async function listCertificates({ branchId = null, studentId = null, programId = null, status = null } = {}) {
    let rows = await certificates$.all();

    if (branchId) rows = rows.filter((c) => c.branchId === branchId);
    if (studentId) rows = rows.filter((c) => c.studentId === studentId);
    if (programId) rows = rows.filter((c) => c.programId === programId);
    if (status) rows = rows.filter((c) => c.status === status);

    return rows
        .map((c) => ({
            ...c,
            templateName: TEMPLATES.find((t) => t.id === c.templateId)?.name || c.templateId,
            levelLabel: levelLabel(c.level)
        }))
        .sort((a, b) => b.issuedOn.localeCompare(a.issuedOn) || b.serial.localeCompare(a.serial));
}

/**
 * Everything the print view needs, resolved here so the printable page has no
 * queries of its own and can be rendered into a new window synchronously.
 */
export async function printData(id) {
    const certificate = await certificates$.findOrFail(id);
    const [student, institute, signatory] = await Promise.all([
        students$.find(certificate.studentId),
        settings$.get('institute', {}),
        staff$.find(certificate.issuedBy).catch(() => null)
    ]);

    return {
        certificate,
        student,
        institute,
        signatory,
        verifyHint: `Verify this certificate at the school office quoting serial ${certificate.serial}.`
    };
}

/** Headline figures for the certificates page. */
export async function certificateSummary(branchId = null) {
    const rows = await listCertificates({ branchId });
    const year = String(academicYearOf().start);

    return {
        total: rows.length,
        thisYear: rows.filter((c) => (c.academicYear || '').startsWith(year)).length,
        revoked: rows.filter((c) => c.status === 'revoked').length,
        overridden: rows.filter((c) => c.overridden).length,
        byTemplate: TEMPLATES
            .map((t) => ({ id: t.id, name: t.name, count: rows.filter((c) => c.templateId === t.id).length }))
            .filter((row) => row.count > 0),
        latest: rows[0] || null
    };
}

/* ------------------------------------------------------------------ HELPERS */

function formatSerial(sequence, year) {
    return `NAT/CRT/${String(year).slice(-2)}/${String(sequence).padStart(4, '0')}`;
}

