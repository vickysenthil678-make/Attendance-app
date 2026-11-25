const ParentNotification = require('../models/ParentNotification');
const Student = require('../models/Student');
const { sendSms, getSmsMode, MODE_TRIAL } = require('../services/smsService');

const MAX_RETRY_ATTEMPTS = 3;

function normalizeIndianMobile(value) {
    const digits = String(value || '').replace(/\D/g, '');
    let nationalNumber = digits;

    if (nationalNumber.length === 13 && nationalNumber.startsWith('091')) {
        nationalNumber = nationalNumber.slice(1);
    }
    if (nationalNumber.length === 12 && nationalNumber.startsWith('91')) {
        nationalNumber = nationalNumber.slice(2);
    } else if (nationalNumber.length === 11 && nationalNumber.startsWith('0')) {
        nationalNumber = nationalNumber.slice(1);
    }

    if (!/^[6-9]\d{9}$/.test(nationalNumber)) {
        return null;
    }
    return `91${nationalNumber}`;
}

function maskPhoneNumber(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.length <= 4) return '*'.repeat(digits.length);
    return `${digits.slice(0, 2)}${'*'.repeat(Math.max(4, digits.length - 6))}${digits.slice(-4)}`;
}

function buildEventKey(eventType, attendance) {
    return [
        String(attendance.studentId).trim().toUpperCase(),
        String(attendance.attendanceRecordId || attendance._id),
        eventType
    ].join(':');
}

function buildLegacyEventKey(eventType, attendance) {
    return [
        eventType,
        attendance.department,
        attendance.program,
        attendance.year,
        String(attendance.studentId).trim().toUpperCase(),
        attendance.date
    ].join(':');
}

function getSkipReason(student) {
    // In TRIAL_MODE, custom messages are blocked by Twilio — always skip cleanly
    if (getSmsMode() === MODE_TRIAL) {
        return 'SMS skipped — Twilio trial account cannot send custom messages. Set SMS_MODE=PAID_MODE after upgrading.';
    }
    if (!student) return 'Student record not found';
    if (student.parentSmsOptOut === true) return 'Parent opted out of attendance SMS';
    if (!student.parentPhone || !String(student.parentPhone).trim()) return 'Parent mobile number missing';
    if (!normalizeIndianMobile(student.parentPhone)) return 'Parent mobile number is invalid';
    return '';
}

function notificationFields(eventType, attendance, student) {
    const studentId = String(attendance.studentId).trim().toUpperCase();
    const phone = student && student.parentPhone ? String(student.parentPhone).trim() : '';
    const attendanceRecordId = attendance.attendanceRecordId || attendance._id;
    return {
        eventKey: buildEventKey(eventType, attendance),
        eventType,
        attendanceRecordId,
        studentId,
        studentName: (student && student.studentName) || attendance.studentName || '',
        parentName: (student && student.parentName) || '',
        parentPhone: normalizeIndianMobile(phone) || phone,
        department: attendance.department,
        program: attendance.program,
        year: String(attendance.year),
        classId: attendance.classId,
        attendanceDate: attendance.date
    };
}

async function attemptSend(notification, action = 'attendance_submit') {
    let result;
    try {
        result = await sendSms({
            mobile: notification.parentPhone,
            studentName: notification.studentName,
            studentId: notification.studentId,
            attendanceDate: notification.attendanceDate,
            eventType: notification.eventType
        });
    } catch (error) {
        const failureReason = String(error.message || 'SMS provider request failed').slice(0, 300);
        console.error(`Parent SMS ${notification.eventType} send failed for ${notification.studentId}: ${failureReason}`);
        return ParentNotification.findByIdAndUpdate(
            notification._id,
            {
                $set: { status: 'failed', failureReason },
                $inc: { attempts: 1 },
                $push: {
                    statusHistory: {
                        status: 'failed',
                        action,
                        reason: failureReason,
                        at: new Date()
                    }
                }
            },
            { new: true }
        );
    }

    return ParentNotification.findByIdAndUpdate(
        notification._id,
        {
            $set: {
                status: 'sent',
                failureReason: '',
                providerMessageId: result.messageId,
                sentAt: new Date()
            },
            $inc: { attempts: 1 },
            $push: {
                statusHistory: {
                    status: 'sent',
                    action,
                    reason: '',
                    at: new Date()
                }
            }
        },
        { new: true }
    );
}

async function createAndSend(eventType, attendance, student, skipReason) {
    const reason = skipReason || getSkipReason(student);
    const fields = notificationFields(eventType, attendance, student);
    const initialStatus = reason
        ? (reason === 'Parent mobile number is invalid' ? 'failed' : 'skipped')
        : 'pending';
    fields.status = initialStatus;
    fields.statusHistory = [{
        status: initialStatus,
        action: 'attendance_submit',
        reason: reason || '',
        at: new Date()
    }];
    if (reason) {
        fields.failureReason = reason;
    }

    let notification;
    try {
        notification = await ParentNotification.findOne({
            $or: [
                { eventKey: fields.eventKey },
                { eventKey: buildLegacyEventKey(eventType, attendance) },
                {
                    studentId: fields.studentId,
                    attendanceRecordId: fields.attendanceRecordId,
                    eventType
                }
            ]
        });
        if (notification) {
            if (
                reason ||
                eventType !== 'absence' ||
                notification.status !== 'skipped' ||
                Number(notification.attempts || 0) !== 0
            ) {
                return notification;
            }

            const history = [];
            if (!notification.statusHistory || notification.statusHistory.length === 0) {
                history.push({
                    status: 'skipped',
                    action: 'legacy_skip',
                    reason: notification.failureReason || 'Previously skipped',
                    at: notification.createdAt || new Date()
                });
            }
            history.push({
                status: 'pending',
                action: 'attendance_submit_replay',
                reason: 'Attendance was submitted again and current parent contact checks passed',
                at: new Date()
            });

            let claimed;
            try {
                claimed = await ParentNotification.findOneAndUpdate(
                    {
                        _id: notification._id,
                        status: 'skipped',
                        attempts: 0
                    },
                    {
                        $set: {
                            eventKey: fields.eventKey,
                            attendanceRecordId: fields.attendanceRecordId,
                            status: 'pending',
                            failureReason: '',
                            parentName: fields.parentName,
                            studentName: fields.studentName,
                            parentPhone: fields.parentPhone
                        },
                        $push: { statusHistory: { $each: history } }
                    },
                    { new: true }
                );
            } catch (error) {
                if (error.code !== 11000) throw error;
                return notification;
            }
            if (!claimed) return notification;
            return attemptSend(claimed, 'attendance_submit_replay');
        }

        notification = await ParentNotification.create(fields);
    } catch (error) {
        if (error.code !== 11000) throw error;
        notification = await ParentNotification.findOne({
            $or: [
                { eventKey: fields.eventKey },
                { eventKey: buildLegacyEventKey(eventType, attendance) },
                {
                    studentId: fields.studentId,
                    attendanceRecordId: fields.attendanceRecordId,
                    eventType
                }
            ]
        });
        if (!notification) throw error;
        return notification;
    }

    if (reason) return notification;
    return attemptSend(notification);
}

async function processAttendanceEvents(events) {
    const studentIds = [...new Set(events.map(event => String(event.attendance.studentId).trim().toUpperCase()))];
    const firstAttendance = events[0] && events[0].attendance;
    if (!firstAttendance || studentIds.length === 0) {
        return { processed: 0, failed: 0, skipped: 0 };
    }

    const students = await Student.find({
        studentId: { $in: studentIds },
        department: firstAttendance.department,
        year: String(firstAttendance.year),
        program: firstAttendance.program
    }).select('studentId studentName parentName parentPhone parentRelationship parentSmsOptOut').lean();
    const studentsById = new Map(students.map(student => [student.studentId, student]));
    let failed = 0;
    let skipped = 0;
    const details = [];

    for (const event of events) {
        const studentId = String(event.attendance.studentId).trim().toUpperCase();
        const student = studentsById.get(studentId);
        let skipReason = '';
        if (event.eventType === 'correction') {
            const absence = await ParentNotification.findOne({
                $or: [
                    { eventKey: buildEventKey('absence', event.attendance) },
                    { eventKey: buildLegacyEventKey('absence', event.attendance) }
                ]
            }).select('status').lean();
            if (!absence || !['sent', 'delivered'].includes(absence.status)) {
                skipReason = 'No absence SMS was successfully sent';
            }
        }

        const notification = await createAndSend(event.eventType, event.attendance, student, skipReason);
        if (notification && notification.status === 'failed') failed++;
        if (notification && notification.status === 'skipped') skipped++;
        if (notification) {
            details.push({
                studentId,
                status: notification.status,
                reason: notification.failureReason || ''
            });
        }
    }

    return { processed: events.length, failed, skipped, details };
}

async function retryNotification(notificationId) {
    const notification = await ParentNotification.findOne({
        _id: notificationId,
        department: 'Computer Science',
        program: { $in: ['UG', 'PG'] },
        status: 'failed',
        attempts: { $lt: MAX_RETRY_ATTEMPTS }
    });
    if (!notification) return null;

    const student = await Student.findOne({
        studentId: notification.studentId,
        department: notification.department,
        year: notification.year,
        program: notification.program
    }).select('studentName parentName parentPhone parentSmsOptOut').lean();
    const skipReason = getSkipReason(student);
    if (skipReason) {
        const status = skipReason === 'Parent mobile number is invalid' ? 'failed' : 'skipped';
        return ParentNotification.findOneAndUpdate(
            { _id: notification._id, status: 'failed' },
            {
                $set: { status, failureReason: skipReason },
                $push: {
                    statusHistory: {
                        status,
                        action: 'admin_retry_validation',
                        reason: skipReason,
                        at: new Date()
                    }
                }
            },
            { new: true }
        );
    }

    const claimed = await ParentNotification.findOneAndUpdate(
        {
            _id: notification._id,
            status: 'failed',
            attempts: { $lt: MAX_RETRY_ATTEMPTS }
        },
        {
            $set: {
                status: 'pending',
                failureReason: '',
                parentPhone: normalizeIndianMobile(student.parentPhone),
                studentName: student.studentName || notification.studentName
            },
            $push: {
                statusHistory: {
                    status: 'pending',
                    action: 'admin_retry',
                    reason: '',
                    at: new Date()
                }
            }
        },
        { new: true }
    );
    if (!claimed) return null;

    claimed.parentName = student.parentName || '';
    return attemptSend(claimed, 'admin_retry');
}

module.exports = {
    MAX_RETRY_ATTEMPTS,
    buildEventKey,
    buildLegacyEventKey,
    getSkipReason,
    maskPhoneNumber,
    normalizeIndianMobile,
    processAttendanceEvents,
    retryNotification
};
