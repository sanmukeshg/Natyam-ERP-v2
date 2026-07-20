/**
 * Event bus.
 *
 * Modules never import each other. When a payment is recorded, the fees module
 * emits `fee:paid`; the dashboard, the notification centre and the sidebar
 * badge each decide independently whether they care. This is what keeps the
 * dependency graph a tree instead of a mesh.
 *
 * Over 1.0's bus this adds: namespace wildcards, `once`, error isolation, and
 * scoped subscriptions that a controller can dispose in one call.
 */

class EventBus {
    constructor() {
        this.handlers = new Map();
        this.debug = false;
    }

    /**
     * Subscribes to an event. `'fee:*'` matches every event in the `fee`
     * namespace; `'*'` matches everything.
     * @returns {Function} unsubscribe
     */
    on(event, handler) {
        if (!this.handlers.has(event)) this.handlers.set(event, new Set());
        this.handlers.get(event).add(handler);
        return () => this.off(event, handler);
    }

    once(event, handler) {
        const wrapped = (payload, name) => {
            this.off(event, wrapped);
            handler(payload, name);
        };
        return this.on(event, wrapped);
    }

    off(event, handler) {
        const set = this.handlers.get(event);
        if (!set) return;
        set.delete(handler);
        if (!set.size) this.handlers.delete(event);
    }

    /**
     * One misbehaving subscriber must not stop the others, and must not
     * bubble an exception back into the emitter's business logic.
     */
    emit(event, payload) {
        if (this.debug) console.debug('[bus]', event, payload);

        const namespace = event.includes(':') ? `${event.split(':')[0]}:*` : null;
        const sets = [this.handlers.get(event), namespace && this.handlers.get(namespace), this.handlers.get('*')];

        for (const set of sets) {
            if (!set) continue;
            for (const handler of Array.from(set)) {
                try {
                    handler(payload, event);
                } catch (err) {
                    console.error(`[bus] handler for "${event}" failed`, err);
                }
            }
        }
    }

    /**
     * A disposable group of subscriptions. Controllers use this so teardown is
     * a single call and a route change can never leave a listener behind
     * updating a detached DOM node.
     */
    scope() {
        const disposers = [];
        return {
            on: (event, handler) => { disposers.push(this.on(event, handler)); },
            once: (event, handler) => { disposers.push(this.once(event, handler)); },
            dispose: () => { disposers.forEach((d) => d()); disposers.length = 0; }
        };
    }

    clear() { this.handlers.clear(); }
}

export const bus = new EventBus();

/** Canonical event names. Emitters and listeners import from here, not strings. */
export const EVENTS = Object.freeze({
    APP_READY:          'app:ready',
    BRANCH_CHANGED:     'app:branch-changed',
    THEME_CHANGED:      'app:theme-changed',
    PREFS_CHANGED:      'app:prefs-changed',

    ROUTE_START:        'route:start',
    ROUTE_DONE:         'route:done',
    ROUTE_FAILED:       'route:failed',

    STUDENT_CREATED:    'student:created',
    STUDENT_UPDATED:    'student:updated',
    STUDENT_REMOVED:    'student:removed',

    ADMISSION_SUBMITTED:'admission:submitted',
    ADMISSION_APPROVED: 'admission:approved',
    ADMISSION_ENROLLED: 'admission:enrolled',

    ATTENDANCE_SAVED:   'attendance:saved',
    LEAVE_REQUESTED:    'attendance:leave-requested',
    LEAVE_DECIDED:      'attendance:leave-decided',
    HOLIDAY_CHANGED:    'attendance:holiday-changed',

    BATCH_CREATED:      'batch:created',
    BATCH_UPDATED:      'batch:updated',
    BATCH_CLOSED:       'batch:closed',

    STAFF_CREATED:      'staff:created',
    STAFF_UPDATED:      'staff:updated',

    PROGRAM_SCHEDULED:  'program:scheduled',
    PROGRAM_UPDATED:    'program:updated',
    PROGRAM_COMPLETED:  'program:completed',

    CERTIFICATE_ISSUED: 'certificate:issued',
    CERTIFICATE_REVOKED:'certificate:revoked',

    INVOICE_CREATED:    'fee:invoice-created',
    PAYMENT_RECORDED:   'fee:paid',
    PAYMENT_REFUNDED:   'fee:refunded',

    EXPENSE_RECORDED:   'finance:expense',
    LEDGER_POSTED:      'finance:posted',
    SALARY_PROCESSED:   'finance:salary',

    SETTINGS_CHANGED:   'settings:changed',
    BACKUP_RESTORED:    'settings:restored',
    NOTIFICATION_ADDED: 'notification:added',
    NOTIFICATION_READ:  'notification:read',

    NOTIFY:             'notify',
    DATA_IMPORTED:      'data:imported'
});
