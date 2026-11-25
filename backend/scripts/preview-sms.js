/**
 * preview-sms.js
 * Run:  node scripts/preview-sms.js
 *
 * Shows the exact SMS message that would be sent to each absent student's parent.
 * Does NOT call Twilio. Safe to run at any time.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { buildAbsenceMessage } = require('../services/smsService');

function toE164Indian(value) {
    const digits = String(value || '').replace(/\D/g, '');
    let n = digits;
    if (n.length === 13 && n.startsWith('091')) n = n.slice(1);
    if (n.length === 12 && n.startsWith('91')) n = n.slice(2);
    else if (n.length === 11 && n.startsWith('0')) n = n.slice(1);
    if (!/^[6-9]\d{9}$/.test(n)) return null;
    return '+91' + n;
}

mongoose.connect(process.env.MONGODB_URI).then(async () => {
    const Student = require('../models/Student');

    const students = await Student.find({
        department: 'Computer Science',
        program: 'UG',
        year: '1',
        status: 'active'
    }).select('studentId studentName parentPhone').lean();

    const today = new Date().toISOString().slice(0, 10);

    console.log('');
    console.log('SMS PREVIEW — Absent Notification');
    console.log('Date: ' + today);
    console.log('='.repeat(60));

    let canSend = 0;
    let noPhone = 0;
    let invalid = 0;

    students.forEach(s => {
        const raw = s.parentPhone;
        const e164 = raw ? toE164Indian(raw) : null;

        if (!raw || !raw.trim()) {
            noPhone++;
            console.log('\n[SKIP] ' + s.studentId + ' - ' + s.studentName);
            console.log('       Reason: No parent phone number stored');
            return;
        }

        if (!e164) {
            invalid++;
            console.log('\n[FAIL] ' + s.studentId + ' - ' + s.studentName);
            console.log('       Stored number: ' + raw);
            console.log('       Reason: Invalid number format');
            return;
        }

        canSend++;
        const msg = buildAbsenceMessage({
            studentName: s.studentName,
            studentId: s.studentId,
            attendanceDate: today
        });

        console.log('\n[WILL SEND] ' + s.studentId + ' - ' + s.studentName);
        console.log('  To (parent): ' + e164);
        console.log('  ─'.repeat(28));
        console.log(msg.split('\n').map(l => '  ' + l).join('\n'));
        console.log('  ' + '─'.repeat(55));
    });

    console.log('');
    console.log('='.repeat(60));
    console.log('SUMMARY:');
    console.log('  Will send SMS : ' + canSend + ' students');
    console.log('  No phone      : ' + noPhone + ' students (skipped)');
    console.log('  Invalid phone : ' + invalid + ' students (failed)');
    console.log('');
    console.log('NOTE: In TRIAL_MODE the parent receives a generic Twilio demo');
    console.log('      message, not the custom text shown above.');
    console.log('      Set SMS_MODE=PAID_MODE after upgrading Twilio to send');
    console.log('      the actual custom absence message.');

    mongoose.disconnect();
}).catch(e => {
    console.error('Error:', e.message);
    process.exit(1);
});
