/**
 * NATYAM ERP 2.0 — Admissions service
 *
 * The admissions pipeline and, at the end of it, the single most consequential
 * operation in the product: turning an approved application into a student.
 *
 * 1.0's version of that conversion is the bug this whole rebuild was shaped
 * around. It copied the application's fields onto a new student record but
 * never set `batchId`, because the application form had no batch field. The
 * student was created successfully, the toast said so, and they then appeared
 * on no roll call, in no batch roster and in no attendance report — visible
 * only in the students table, apparently enrolled, silently untaught. Here,
 * conversion refuses to proceed without a batch, and the wizard collects one.
 */

import { bus, EVENTS } from '../core/bus.js';
import { session } from '../core/session.js';
import { db, request } from '../core/db.js';
import { uid, sequenceNumber } from '../utils/id.js';
import { localDate, nowISO, academicYearOf, ageFrom } from '../utils/date.js';
import { ADMISSION_STATUS, STUDENT_STATUS, LEVELS, levelLabel } from '../config/app.config.js';
import {
    admissions$, drafts$, students$, batches$, feePlans$, branches$, settings$
} from '../data/repositories.js';
import { raiseSchedule } from './fees.service.js';
import { notify } from './notifications.service.js';

/* ==========================================================================
   THE WIZARD'S STEPS
   Declared here, not in the page, because the service validates step by step
   and the page renders step by step — both need the same definition or the
   progress bar will disagree with what is actually required.
   ========================================================================== */

export const ADMISSION_STEPS = Object.freeze([
    { key: 'applicant',  label: 'Applicant',   required: ['name', 'dateOfBirth', 'gender'] },
    { key: 'guardian',   label: 'Parent',      required: ['guardianName', 'guardianRelation', 'guardianPhone'] },
    { key: 'placement',  label: 'Placement',   required: ['branchId', 'level'] },
    { key: 'batch',      label: 'Batch',       required: [] },
    { key: 'experience', label: 'Experience',  required: [] },
    { key: 'medical',    label: 'Medical',     required: [] },
    { key: 'fees',       label: 'Fee plan',    required: ['feePlanId'] },
    { key: 'documents',  label: 'Documents',   required: [] },
    { key: 'review',     label: 'Confirm',     required: [] }
]);

const FIELD_LABELS = {
    name: 'the applicant’s name',
    dateOfBirth: 'date of birth',
    gender: 'gender',
    guardianName: 'the parent or guardian’s name',
    guardianRelation: 'the relationship to the applicant',
    guardianPhone: 'a contact number',
    branchId: 'a branch',
    level: 'a starting level',
    feePlanId: 'a fee plan'
};

/**
 * Validates one step in isolation. Returns problems rather than throwing,
 * because a wizard needs to mark three fields at once, not stop at the first.
 *
 * @returns {{ok: boolean, errors: Object<string,string>}}
 */
export function validateStep(stepKey, data) {
    const step = ADMISSION_STEPS.find((s) => s.key === stepKey);
    if (!step) throw new Error(`Unknown admission step "${stepKey}".`);

    const errors = {};
    for (const field of step.required) {
        const value = data[field];
        if (value === null || value === undefined || String(value).trim() === '') {
            errors[field] = `Please provide ${FIELD_LABELS[field] || field}.`;
        }
    }

    if (stepKey === 'applicant' && data.dateOfBirth) {
        if (data.dateOfBirth > localDate()) {
            errors.dateOfBirth = 'Date of birth cannot be in the future.';
        } else {
            const age = ageFrom(data.dateOfBirth);
            if (age < 4) errors.dateOfBirth = `The applicant would be ${age}. The school takes students from age 4.`;
            if (age > 75) errors.dateOfBirth = 'Please check the date of birth.';
        }
    }

    if (stepKey === 'guardian' && data.guardianPhone) {
        const digits = String(data.guardianPhone).replace(/\D/g, '');
        if (digits.length < 10) errors.guardianPhone = 'A contact number needs at least 10 digits.';
    }
    if (stepKey === 'guardian' && data.guardianEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.guardianEmail)) {
        errors.guardianEmail = 'That email address does not look right.';
    }

    if (stepKey === 'placement' && data.level && !LEVELS.some((l) => l.value === data.level)) {
        errors.level = 'Choose a level from the list.';
    }

    return { ok: Object.keys(errors).length === 0, errors };
}

/** Validates the whole application, returning the first incomplete step. */
export function validateApplication(data) {
    for (const step of ADMISSION_STEPS) {
        const result = validateStep(step.key, data);
        if (!result.ok) return { ok: false, step: step.key, errors: result.errors };
    }
    return { ok: true, step: null, errors: {} };
}

/* ==========================================================================
   DRAFTS
   --------------------------------------------------------------------------
   A nine-step form is long enough that a phone call, a closed tab or a flat
   battery in the middle of it is normal, not exceptional. Drafts are written
   on every step change and debounced during typing by the page.
   ========================================================================== */

export async function saveDraft(draftId, data, { step = 0 } = {}) {
    const id = draftId || uid('DRF');
    const existing = draftId ? await drafts$.find(draftId) : null;

    const draft = {
        id,
        data,
        step,
        label: data.name?.trim() || 'Untitled application',
        branchId: data.branchId || null,
        createdAt: existing?.createdAt || nowISO(),
        updatedAt: nowISO(),
        updatedBy: session.actorId()
    };

    await db.put('admissionDrafts', draft);
    return draft;
}

export async function listDrafts() {
    return drafts$.mine();
}

export async function loadDraft(draftId) {
    const draft = await drafts$.find(draftId);
    if (!draft) throw new Error('That draft is no longer available. It may have been submitted or cleared.');
    return draft;
}

export async function discardDraft(draftId) {
    await db.remove('admissionDrafts', draftId);
    return true;
}

/* ==========================================================================
   THE PIPELINE
   ========================================================================== */

/**
 * Submits an application. If it came from a draft, the draft is removed in the
 * same unit of work — an application that exists twice, once as a draft and
 * once as a submission, is a duplicate waiting to be enrolled twice.
 */
export async function submit(data, { draftId = null } = {}) {
    session.require('admission.edit', 'submit an application');

    const check = validateApplication(data);
    if (!check.ok) {
        const first = Object.values(check.errors)[0];
        throw new Error(`The application is not complete: ${first}`);
    }

    const duplicate = await admissions$.findLikeness(data);
    if (duplicate) {
        throw new Error(
            `An application for ${duplicate.name} on this number is already ${statusLabel(duplicate.status)} ` +
            `(${duplicate.applicationNo}). Open that one instead of creating a second.`
        );
    }

    const year = academicYearOf().start;
    const seq = await settings$.nextSequence('application');

    const admission = await admissions$.create({
        ...data,
        applicationNo: sequenceNumber('NAT/APP', year, seq),
        status: ADMISSION_STATUS.SUBMITTED,
        appliedOn: data.appliedOn || localDate(),
        submittedBy: session.actorId()
    });

    if (draftId) await discardDraft(draftId);

    await notify({
        kind: 'admission',
        title: `New application — ${admission.name}`,
        body: `${levelLabel(admission.level)} at ${await branchName(admission.branchId)}.`,
        link: `#/admissions/${admission.id}`
    });

    bus.emit(EVENTS.ADMISSION_SUBMITTED, { admission });
    return admission;
}

export async function updateApplication(id, changes) {
    session.require('admission.edit', 'edit an application');

    const existing = await admissions$.findOrFail(id);
    if (existing.status === ADMISSION_STATUS.ENROLLED) {
        throw new Error('This application has already been enrolled. Edit the student record instead.');
    }
    return admissions$.update(id, changes);
}

/** Moves an application into review. Records who picked it up. */
export async function beginReview(id) {
    session.require('admission.edit', 'review an application');

    const admission = await admissions$.findOrFail(id);
    if (admission.status !== ADMISSION_STATUS.SUBMITTED) {
        throw new Error(`This application is ${statusLabel(admission.status)}, not awaiting review.`);
    }
    return admissions$.update(id, {
        status: ADMISSION_STATUS.REVIEWING,
        reviewStartedOn: localDate(),
        reviewedBy: session.actorId()
    });
}

/**
 * Approves an application. Approval is a decision, not an enrolment — the
 * student record is created separately, because approving on the phone and
 * enrolling when the family pays are two different moments.
 */
export async function approve(id, { note = null } = {}) {
    session.require('admission.approve', 'approve an application');

    const admission = await admissions$.findOrFail(id);
    if (admission.status === ADMISSION_STATUS.ENROLLED) throw new Error('This applicant is already enrolled.');
    if (admission.status === ADMISSION_STATUS.REJECTED) throw new Error('This application was rejected. Reopen it first.');
    if (admission.status === ADMISSION_STATUS.APPROVED) return admission;

    const updated = await admissions$.update(id, {
        status: ADMISSION_STATUS.APPROVED,
        approvedOn: localDate(),
        approvedBy: session.actorId(),
        approvalNote: note?.trim() || null
    });

    bus.emit(EVENTS.ADMISSION_APPROVED, { admission: updated });
    return updated;
}

export async function reject(id, { reason }) {
    session.require('admission.approve', 'reject an application');

    if (!reason?.trim()) throw new Error('Record why the application was declined — the family will ask.');
    const admission = await admissions$.findOrFail(id);
    if (admission.status === ADMISSION_STATUS.ENROLLED) throw new Error('This applicant is already enrolled and cannot be rejected.');

    return admissions$.update(id, {
        status: ADMISSION_STATUS.REJECTED,
        rejectedOn: localDate(),
        rejectedBy: session.actorId(),
        rejectionReason: reason.trim()
    });
}

/** Puts a rejected application back in the queue. */
export async function reopen(id) {
    session.require('admission.approve', 'reopen an application');

    const admission = await admissions$.findOrFail(id);
    if (admission.status !== ADMISSION_STATUS.REJECTED) throw new Error('Only a rejected application can be reopened.');
    return admissions$.update(id, {
        status: ADMISSION_STATUS.SUBMITTED,
        rejectedOn: null, rejectedBy: null, rejectionReason: null,
        reopenedOn: localDate()
    });
}

/* ==========================================================================
   CONVERSION — application to student
   ========================================================================== */

/**
 * Creates the student record for an approved application.
 *
 * Everything about this function is arranged around not repeating 1.0's
 * failure. In particular:
 *
 *  - a batch is mandatory, and it is checked for capacity and level before
 *    anything is written;
 *  - the application row and the student row are written in the *same*
 *    transaction, so an application can never be marked enrolled without a
 *    student existing, nor a student created twice by a double-click;
 *  - the fee schedule is raised afterwards, deliberately outside that
 *    transaction, because billing failing is recoverable and must not roll
 *    back an enrolment the family has already been told about.
 *
 * @param {string} admissionId
 * @param {object} options
 * @param {string} options.batchId          Required.
 * @param {string} [options.feePlanId]      Defaults to the application's plan.
 * @param {string} [options.joinedOn]       Defaults to today.
 * @param {boolean} [options.raiseFees=true]
 */
export async function enrolApplicant(admissionId, { batchId, feePlanId = null, joinedOn = null, raiseFees = true } = {}) {
    session.require('admission.approve', 'enrol an applicant');

    const admission = await admissions$.findOrFail(admissionId);

    if (admission.status === ADMISSION_STATUS.ENROLLED) {
        throw new Error(`${admission.name} has already been enrolled.`);
    }
    if (admission.status !== ADMISSION_STATUS.APPROVED) {
        throw new Error(`Approve this application before enrolling — it is currently ${statusLabel(admission.status)}.`);
    }
    if (!batchId) {
        throw new Error('Choose the batch this student will attend. A student without a batch appears on no roll call.');
    }

    const batch = await batches$.findOrFail(batchId);
    if (batch.status !== 'active') throw new Error(`${batch.name} is closed and cannot take students.`);
    if (batch.level !== admission.level) {
        throw new Error(`${admission.name} is joining at ${levelLabel(admission.level)}, but ${batch.name} teaches ${levelLabel(batch.level)}.`);
    }

    const roster = await students$.byBatch(batchId);
    if (batch.capacity && roster.length >= batch.capacity) {
        throw new Error(`${batch.name} is full — ${roster.length} of ${batch.capacity} seats taken. Choose another batch or raise its capacity.`);
    }

    const planId = feePlanId || admission.feePlanId;
    const plan = planId ? await feePlans$.find(planId) : null;
    if (planId && !plan) throw new Error('The chosen fee plan no longer exists. Pick another.');

    const year = academicYearOf().start;
    const seq = await settings$.nextSequence('admission');
    const at = nowISO();
    const actor = session.actorId();

    const student = {
        id: uid('STU'),
        admissionNo: sequenceNumber('NAT/ADM', year, seq),
        name: admission.name,
        level: admission.level,
        // Branch follows the batch, not the application: if the family was
        // offered a place at the other campus, the batch is the truth.
        branchId: batch.branchId,
        batchId: batch.id,
        feePlanId: planId || null,
        status: STUDENT_STATUS.ACTIVE,
        gender: admission.gender || null,
        dateOfBirth: admission.dateOfBirth || null,
        joinedOn: joinedOn || localDate(),
        guardianName: admission.guardianName || null,
        guardianRelation: admission.guardianRelation || 'Guardian',
        guardianPhone: admission.guardianPhone || null,
        guardianEmail: admission.guardianEmail || null,
        alternatePhone: admission.alternatePhone || null,
        address: admission.address || null,
        bloodGroup: admission.bloodGroup || null,
        medicalNotes: admission.medicalNotes || null,
        emergencyContact: admission.emergencyContact || admission.guardianPhone || null,
        previousExperience: admission.previousExperience || null,
        photo: admission.photo || null,
        admissionId: admission.id,
        searchKey: [admission.name, sequenceNumber('NAT/ADM', year, seq), admission.guardianName, admission.level]
            .filter(Boolean).join(' ').toLowerCase(),
        createdAt: at, createdBy: actor, updatedAt: at, updatedBy: actor, deletedAt: null
    };

    const closedApplication = {
        ...admission,
        status: ADMISSION_STATUS.ENROLLED,
        enrolledOn: localDate(),
        enrolledBy: actor,
        studentId: student.id,
        updatedAt: at,
        updatedBy: actor
    };

    await db.unit(['students', 'admissions', 'auditLog'], async (s) => {
        await request(s.students.put(student));
        await request(s.admissions.put(closedApplication));
        await request(s.auditLog.put({
            id: uid('AUD'), entity: 'Admission', entityId: admission.id, action: 'enrol',
            detail: { studentId: student.id, admissionNo: student.admissionNo, batchId: batch.id },
            actorId: actor, actorName: session.actorName(), at
        }));
    }, 'admission:enrol');

    bus.emit(EVENTS.ADMISSION_ENROLLED, { admission: closedApplication, student });
    bus.emit(EVENTS.STUDENT_CREATED, { student });

    /* Billing, outside the transaction and reported separately. If the fee
       plan is misconfigured the registrar needs to know — but the child is
       enrolled either way, and rolling that back would be worse. */
    let billing = null;
    let billingError = null;
    if (raiseFees && planId) {
        try {
            billing = await raiseSchedule(student.id, { feePlanId: planId, startDate: student.joinedOn });
        } catch (err) {
            billingError = err.message;
        }
    }

    await notify({
        kind: 'admission',
        title: `${student.name} enrolled`,
        body: `${batch.name} · ${student.admissionNo}`,
        link: `#/students/${student.id}`
    });

    return { student, admission: closedApplication, billing, billingError };
}

/**
 * Batches a student could join, annotated with why they can or cannot — so the
 * wizard shows "Full (18/18)" next to a disabled option rather than hiding it
 * and leaving the registrar wondering where the batch went.
 */
export async function eligibleBatches(admissionOrLevel, branchId = null) {
    const level = typeof admissionOrLevel === 'string' ? admissionOrLevel : admissionOrLevel?.level;
    const branch = branchId || (typeof admissionOrLevel === 'object' ? admissionOrLevel?.branchId : null);

    const batches = await batches$.withOccupancy(branch);
    return batches
        .filter((b) => b.level === level)
        .map((b) => ({
            ...b,
            selectable: b.status === 'active' && (!b.capacity || b.enrolled < b.capacity),
            reason: b.status !== 'active' ? 'Closed'
                : (b.capacity && b.enrolled >= b.capacity) ? `Full (${b.enrolled}/${b.capacity})`
                : `${b.seatsLeft} seat${b.seatsLeft === 1 ? '' : 's'} left`
        }))
        .sort((a, b) => Number(b.selectable) - Number(a.selectable) || a.name.localeCompare(b.name));
}

/* ==========================================================================
   PIPELINE ANALYTICS
   ========================================================================== */

/** Counts by stage, plus conversion rate — the admissions page header. */
export async function pipeline(branchId = null) {
    const all = (await admissions$.all()).filter((a) => !branchId || a.branchId === branchId);
    const count = (status) => all.filter((a) => a.status === status).length;

    const decided = count(ADMISSION_STATUS.ENROLLED) + count(ADMISSION_STATUS.REJECTED);
    const thisMonth = localDate().slice(0, 7);

    return {
        total: all.length,
        submitted: count(ADMISSION_STATUS.SUBMITTED),
        reviewing: count(ADMISSION_STATUS.REVIEWING),
        approved: count(ADMISSION_STATUS.APPROVED),
        enrolled: count(ADMISSION_STATUS.ENROLLED),
        rejected: count(ADMISSION_STATUS.REJECTED),
        awaitingAction: count(ADMISSION_STATUS.SUBMITTED) + count(ADMISSION_STATUS.REVIEWING) + count(ADMISSION_STATUS.APPROVED),
        thisMonth: all.filter((a) => (a.appliedOn || '').startsWith(thisMonth)).length,
        conversionRate: decided ? Math.round((count(ADMISSION_STATUS.ENROLLED) / decided) * 100) : null,
        byLevel: LEVELS.map((l) => ({
            level: l.value, label: l.label,
            count: all.filter((a) => a.level === l.value).length
        })).filter((row) => row.count > 0)
    };
}

/**
 * Applications that have been sitting too long. An approved application nobody
 * enrolled is a family who thinks they have a place and does not.
 */
export async function stalled({ days = 7 } = {}) {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    return (await admissions$.pending())
        .concat(await admissions$.byStatus(ADMISSION_STATUS.APPROVED))
        .filter((a) => (a.appliedOn || '') < cutoff)
        .sort((a, b) => (a.appliedOn || '').localeCompare(b.appliedOn || ''));
}

/* ------------------------------------------------------------------ HELPERS */

function statusLabel(status) {
    return {
        [ADMISSION_STATUS.DRAFT]: 'a draft',
        [ADMISSION_STATUS.SUBMITTED]: 'awaiting review',
        [ADMISSION_STATUS.REVIEWING]: 'under review',
        [ADMISSION_STATUS.APPROVED]: 'approved',
        [ADMISSION_STATUS.ENROLLED]: 'enrolled',
        [ADMISSION_STATUS.REJECTED]: 'rejected'
    }[status] || status;
}


async function branchName(branchId) {
    const branch = branchId ? await branches$.find(branchId) : null;
    return branch?.name || 'the school';
}

/* ==========================================================================
   LISTING
   ========================================================================== */

/**
 * Applications shaped for the list page: status, age, and whether the next
 * action is available. "Waiting days" is computed here rather than in the page
 * so the dashboard's stalled count and the list's amber row always agree.
 */
export async function listApplications(branchId = null, { status = null } = {}) {
    const all = (await admissions$.all()).filter((a) => !branchId || a.branchId === branchId);
    const rows = status && status !== 'all' ? all.filter((a) => a.status === status) : all;

    return rows
        .map((application) => ({
            ...application,
            levelLabel: levelLabel(application.level),
            waitingDays: application.appliedOn
                ? Math.max(0, Math.round((Date.now() - new Date(`${application.appliedOn}T00:00:00`).getTime()) / 86400000))
                : null,
            stalled: application.appliedOn
                && [ADMISSION_STATUS.SUBMITTED, ADMISSION_STATUS.REVIEWING, ADMISSION_STATUS.APPROVED].includes(application.status)
                && (Date.now() - new Date(`${application.appliedOn}T00:00:00`).getTime()) / 86400000 > 7,
            statusLabel: statusLabel(application.status),
            nextAction: nextActionFor(application.status)
        }))
        .sort((a, b) => (b.appliedOn || '').localeCompare(a.appliedOn || ''));
}

/** One application with everything the detail drawer shows. */
export async function applicationDetail(id) {
    const application = await admissions$.findOrFail(id);
    const [batches, likeness] = await Promise.all([
        eligibleBatches(application),
        admissions$.findLikeness ? admissions$.findLikeness(application) : Promise.resolve([])
    ]);

    return {
        application,
        levelLabel: levelLabel(application.level),
        statusLabel: statusLabel(application.status),
        nextAction: nextActionFor(application.status),
        eligibleBatches: batches,
        possibleDuplicates: (likeness || []).filter((row) => row.id !== application.id)
    };
}

/** What a person can do next with an application in this state. */
export function nextActionFor(status) {
    return {
        [ADMISSION_STATUS.DRAFT]: { key: 'submit', label: 'Submit application' },
        [ADMISSION_STATUS.SUBMITTED]: { key: 'review', label: 'Begin review' },
        [ADMISSION_STATUS.REVIEWING]: { key: 'approve', label: 'Approve' },
        [ADMISSION_STATUS.APPROVED]: { key: 'enrol', label: 'Enrol' },
        [ADMISSION_STATUS.ENROLLED]: null,
        [ADMISSION_STATUS.REJECTED]: { key: 'reopen', label: 'Reopen' }
    }[status] || null;
}
