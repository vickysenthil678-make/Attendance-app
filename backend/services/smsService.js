/**
 * smsService.js
 * Twilio SMS service for parent absence notifications.
 *
 * Credentials are read exclusively from environment variables.
 * The Auth Token is never logged or exposed to the frontend.
 *
 * ── SMS_MODE ──────────────────────────────────────────────────────────────────
 *
 * TRIAL_MODE (default)
 *   Does NOT call Twilio at all.
 *   Custom message bodies are rejected by Twilio trial accounts (error 572006).
 *   Sending a predefined appointment-reminder template would be misleading to
 *   parents, so TRIAL_MODE records the notification as "skipped" instead.
 *   No SMS is sent. Admin can see the skip reason in notification history.
 *
 * PAID_MODE
 *   Sends the full personalized message:
 *     "Dear Parent, Your child [NAME] was marked ABSENT today..."
 *   Requires an upgraded (paid) Twilio account.
 *   After upgrading: set SMS_MODE=PAID_MODE in backend/.env and restart.
 *
 * ── TWILIO_PHONE_NUMBER ───────────────────────────────────────────────────────
 *   Must be your Twilio-issued number (from Twilio Console → Phone Numbers).
 *   For trial accounts the shared trial number is e.g. +17372508034.
 *   Do NOT set this to your personal Indian mobile number.
 *
 * ── SMS_TEST_MODE ─────────────────────────────────────────────────────────────
 *   Set SMS_TEST_MODE=true to log the full message without calling Twilio.
 *   Only active in PAID_MODE (TRIAL_MODE skips before reaching this check).
 */

'use strict';

const twilio = require('twilio');

// Read once at module load — values are stable for the process lifetime
const COLLEGE_NAME = process.env.COLLEGE_NAME || 'Thanthai Hans Roever College (Autonomous)';

// Valid SMS modes
const MODE_TRIAL = 'TRIAL_MODE';
const MODE_PAID  = 'PAID_MODE';

/** Lazily initialised Twilio client — not created until first SMS is attempted */
let _client = null;

// ─── Twilio client ────────────────────────────────────────────────────────────

function getTwilioClient() {
    if (_client) return _client;

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken  = process.env.TWILIO_AUTH_TOKEN;

    if (!accountSid || !authToken) {
        throw new Error(
            'Twilio credentials missing. Set TWILIO_ACCOUNT_SID and ' +
            'TWILIO_AUTH_TOKEN in backend/.env'
        );
    }
    if (!accountSid.startsWith('AC')) {
        throw new Error(
            'TWILIO_ACCOUNT_SID is invalid — it must start with "AC". ' +
            'Find it at https://console.twilio.com'
        );
    }

    _client = twilio(accountSid, authToken);
    return _client;
}

// ─── Configuration helpers ────────────────────────────────────────────────────

/**
 * Returns the current SMS mode: 'TRIAL_MODE' or 'PAID_MODE'.
 * Defaults to TRIAL_MODE if not set.
 */
function getSmsMode() {
    const raw = String(process.env.SMS_MODE || '').trim().toUpperCase();
    if (raw === MODE_PAID) return MODE_PAID;
    return MODE_TRIAL; // safe default
}

/**
 * Returns the Twilio from-number in E.164 format.
 *
 * IMPORTANT: This must be a Twilio-issued number, not a personal mobile number.
 * For trial accounts, use the shared number shown in Twilio Console.
 * For paid accounts, use the number you purchased.
 */
function getTwilioFromNumber() {
    const raw = String(process.env.TWILIO_PHONE_NUMBER || '').trim();
    if (!raw) {
        throw new Error(
            'TWILIO_PHONE_NUMBER is not set in backend/.env. ' +
            'Set it to your Twilio-issued number (e.g. +17372508034 for trial).'
        );
    }
    // Already in E.164 format
    if (/^\+\d{7,15}$/.test(raw)) return raw;
    // Bare digits — try to normalise as Indian number
    const e164 = toE164Indian(raw);
    if (e164) return e164;
    // Last resort: prefix + and return
    return `+${raw.replace(/\D/g, '')}`;
}

// ─── Phone number helpers ─────────────────────────────────────────────────────

/**
 * Normalises an Indian mobile number to E.164 (+91XXXXXXXXXX).
 * Returns null if the number is not a valid 10-digit Indian mobile.
 *
 * Handles formats: 9876543210  919876543210  09876543210  +919876543210
 *                  + 91 9876543210  (spaces around country code)
 */
function toE164Indian(value) {
    const digits = String(value || '').replace(/\D/g, '');
    let national = digits;

    // Strip leading 091
    if (national.length === 13 && national.startsWith('091')) {
        national = national.slice(1);
    }
    // Strip country code 91
    if (national.length === 12 && national.startsWith('91')) {
        national = national.slice(2);
    } else if (national.length === 11 && national.startsWith('0')) {
        national = national.slice(1);
    }

    // Indian mobiles: 10 digits starting with 6–9
    if (!/^[6-9]\d{9}$/.test(national)) return null;
    return `+91${national}`;
}

// ─── Message builders ─────────────────────────────────────────────────────────

function buildAbsenceMessage({ studentName, studentId, attendanceDate }) {
    let displayDate = attendanceDate;
    try {
        const [y, m, d] = attendanceDate.split('-');
        displayDate = `${d}/${m}/${y}`;
    } catch (_) { /* keep original */ }

    return (
        `Dear Parent,\n\n` +
        `Your child ${studentName} (Roll Number: ${studentId}) was marked ABSENT ` +
        `today (${displayDate}) at ${COLLEGE_NAME}.\n\n` +
        `Please contact the college for further details.\n\n` +
        `College Attendance Management System.`
    );
}

function buildCorrectionMessage({ studentName, studentId, attendanceDate }) {
    let displayDate = attendanceDate;
    try {
        const [y, m, d] = attendanceDate.split('-');
        displayDate = `${d}/${m}/${y}`;
    } catch (_) { /* keep original */ }

    return (
        `Dear Parent,\n\n` +
        `We wish to inform you that the earlier ABSENT mark for your child ` +
        `${studentName} (Roll Number: ${studentId}) on ${displayDate} ` +
        `at ${COLLEGE_NAME} has been corrected to PRESENT.\n\n` +
        `Apologies for any concern caused.\n\n` +
        `College Attendance Management System.`
    );
}


// ─── Main send function ───────────────────────────────────────────────────────

/**
 * Send a single SMS via Twilio.
 *
 * TRIAL_MODE: Does NOT call Twilio. Throws a descriptive error so the caller
 *             logs the notification as skipped — no misleading messages sent.
 *
 * PAID_MODE:  Sends the full personalized "Dear Parent…" message via Twilio.
 *
 * @param {object} params
 * @param {string} params.mobile          - Parent phone from student record
 * @param {string} params.studentName
 * @param {string} params.studentId       - Roll / register number
 * @param {string} params.attendanceDate  - YYYY-MM-DD
 * @param {'absence'|'correction'} params.eventType
 *
 * @returns {Promise<{ messageId: string, status: string, mode: string }>}
 * @throws  {Error} with a descriptive message on any failure
 */
async function sendSms({ mobile, studentName, studentId, attendanceDate, eventType }) {

    const mode = getSmsMode();

    // ── TRIAL_MODE: refuse to send — custom messages are blocked by Twilio ──
    // Sending the appointment-reminder template would be misleading to parents.
    // Record the notification as skipped so the admin can see the reason clearly.
    if (mode === MODE_TRIAL) {
        const reason =
            `SMS not sent — Twilio trial accounts cannot send custom message bodies. ` +
            `Upgrade your Twilio account and set SMS_MODE=PAID_MODE in backend/.env ` +
            `to send the actual absence notification to parents.`;
        console.log(`[SMS TRIAL] Skipping SMS for ${studentId} — ${reason}`);
        throw new Error(reason);
    }

    // ── Validate destination number ──────────────────────────────────────────
    const to = toE164Indian(mobile);
    if (!to) {
        throw new Error(
            `Invalid parent mobile number "${mobile}". ` +
            `Must be a 10-digit Indian mobile starting with 6–9.`
        );
    }

    const from   = getTwilioFromNumber();
    const params = { studentName, studentId, attendanceDate };
    const body   = eventType === 'correction'
        ? buildCorrectionMessage(params)
        : buildAbsenceMessage(params);

    // ── Dry-run / test mode — no Twilio API call ─────────────────────────────
    if (process.env.SMS_TEST_MODE === 'true') {
        console.log('[SMS TEST MODE] No API call made.');
        console.log(`  Mode    : ${mode}`);
        console.log(`  From    : ${from}`);
        console.log(`  To      : ${to}`);
        console.log(`  Event   : ${eventType}`);
        console.log(`  Student : ${studentName} (${studentId})`);
        console.log(`  Date    : ${attendanceDate}`);
        console.log(`  Body    :\n${body}`);
        return { messageId: `test-${Date.now()}`, status: 'test', mode };
    }

    // ── PAID_MODE: send via Twilio ────────────────────────────────────────────
    const client = getTwilioClient();
    let message;

    try {
        message = await client.messages.create({ body, from, to });
    } catch (err) {
        let reason = err.message || 'Twilio API request failed';

        if (err.code === 572006) {
            reason =
                `Twilio error 572006: Custom message bodies require an upgraded Twilio account. ` +
                `Your account is still on trial. Upgrade at https://console.twilio.com ` +
                `then set SMS_MODE=PAID_MODE in backend/.env.`;
        } else if (err.code === 21608) {
            reason =
                `Twilio error 21608: Recipient ${to} is not a verified number. ` +
                `After upgrading Twilio this restriction is removed automatically.`;
        } else if (err.code === 21211) {
            reason = `Twilio error 21211: "${to}" is not a valid phone number.`;
        } else if (err.code === 20003) {
            reason = `Twilio error 20003: Authentication failed. Check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in backend/.env.`;
        } else if (err.code) {
            reason = `Twilio error ${err.code}: ${err.message}`;
            if (err.moreInfo) reason += ` — ${err.moreInfo}`;
        }

        throw new Error(reason);
    }

    console.log(
        `[SMS] PAID_MODE | ${eventType} → ${to} | SID: ${message.sid} | Status: ${message.status}`
    );

    // Twilio returns "queued" on API acceptance — not "delivered".
    // Delivery confirmation comes later via status callback webhook.
    return { messageId: message.sid, status: message.status, mode };
}

// ─── Startup validation ───────────────────────────────────────────────────────

/**
 * Call this once when the backend starts to catch configuration errors early.
 * Does NOT throw — logs warnings so the server still starts.
 */
function validateSmsConfig() {
    const mode = getSmsMode();
    const sid  = process.env.TWILIO_ACCOUNT_SID;
    const auth = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_PHONE_NUMBER;

    const warnings = [];

    if (!sid)  warnings.push('TWILIO_ACCOUNT_SID is not set');
    if (!auth) warnings.push('TWILIO_AUTH_TOKEN is not set');
    if (!from) warnings.push('TWILIO_PHONE_NUMBER is not set');

    if (from && toE164Indian(from) && mode === MODE_TRIAL) {
        warnings.push(
            `TWILIO_PHONE_NUMBER "${from}" looks like an Indian mobile number. ` +
            `For trial mode this must be your Twilio-issued number (e.g. +17372508034). ` +
            `Find it at https://console.twilio.com`
        );
    }

    if (warnings.length > 0) {
        console.warn('[SMS] Configuration warnings:');
        warnings.forEach(w => console.warn('  ⚠', w));
    } else {
        console.log(`[SMS] Configured — mode: ${mode} | from: ${from}`);
    }
}

module.exports = {
    sendSms,
    getSmsMode,
    toE164Indian,
    validateSmsConfig,
    buildAbsenceMessage,
    buildCorrectionMessage,
    MODE_TRIAL,
    MODE_PAID
};
