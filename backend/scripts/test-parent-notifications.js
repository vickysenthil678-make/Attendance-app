const assert = require('assert');
const {
    buildEventKey,
    getSkipReason,
    maskPhoneNumber,
    normalizeIndianMobile
} = require('../utils/parentNotificationService');
const ParentNotification = require('../models/ParentNotification');
const { sendFlowSms } = require('../utils/msg91Service');

async function testAttendanceNotificationSelection() {
    const attendancePath = require.resolve('../models/Attendance');
    const servicePath = require.resolve('../utils/parentNotificationService');
    const controllerPath = require.resolve('../controllers/attendanceController');
    const originalAttendanceModule = require.cache[attendancePath];
    const originalServiceModule = require.cache[servicePath];
    const originalControllerModule = require.cache[controllerPath];
    let previousRecords = [];
    let savedRecords = [];
    let findCall = 0;
    let notificationCalls = [];
    const attendanceModel = {
        find: () => ({
            select() { return this; },
            lean: async () => (findCall++ === 0 ? previousRecords : savedRecords)
        }),
        bulkWrite: async () => ({ acknowledged: true })
    };
    const notificationService = {
        processAttendanceEvents: async events => {
            notificationCalls.push(events);
            return { processed: events.length, failed: 0, skipped: 0 };
        }
    };

    require.cache[attendancePath] = {
        id: attendancePath,
        filename: attendancePath,
        loaded: true,
        exports: attendanceModel
    };
    require.cache[servicePath] = {
        id: servicePath,
        filename: servicePath,
        loaded: true,
        exports: notificationService
    };
    delete require.cache[controllerPath];

    try {
        const { markAttendance } = require('../controllers/attendanceController');
        const submit = async records => {
            findCall = 0;
            const response = {
                statusCode: 0,
                body: null,
                status(code) {
                    this.statusCode = code;
                    return this;
                },
                json(body) {
                    this.body = body;
                    return this;
                }
            };
            await markAttendance({
                user: {
                    _id: 'staff-id',
                    role: 'staff',
                    department: 'Computer Science',
                    program: 'UG',
                    year: '1',
                    classId: 'CS1'
                },
                body: { date: '2026-02-01', records }
            }, response);
            assert.strictEqual(response.statusCode, 200);
            return response.body;
        };

        previousRecords = [];
        savedRecords = [
            { _id: 'attendance-1', studentId: 'CS001', status: 'absent' },
            { _id: 'attendance-2', studentId: 'CS002', status: 'absent' },
            { _id: 'attendance-3', studentId: 'CS003', status: 'present' }
        ];
        await submit([
            { studentId: 'CS001', status: 'absent' },
            { studentId: 'CS002', status: 'absent' },
            { studentId: 'CS003', status: 'present' }
        ]);
        assert.deepStrictEqual(notificationCalls[0].map(event => event.eventType), ['absence', 'absence']);
        assert.deepStrictEqual(
            notificationCalls[0].map(event => String(event.attendance.attendanceRecordId)),
            ['attendance-1', 'attendance-2']
        );

        previousRecords = [{ studentId: 'CS003', status: 'absent' }];
        savedRecords = [{ _id: 'attendance-3', studentId: 'CS003', status: 'present' }];
        await submit([{ studentId: 'CS003', status: 'present' }]);
        assert.strictEqual(notificationCalls[1][0].eventType, 'correction');
        assert.strictEqual(String(notificationCalls[1][0].attendance.attendanceRecordId), 'attendance-3');

        previousRecords = [{ studentId: 'CS003', status: 'present' }];
        savedRecords = [{ _id: 'attendance-3', studentId: 'CS003', status: 'present' }];
        const presentOnly = await submit([{ studentId: 'CS003', status: 'present' }]);
        assert.strictEqual(notificationCalls.length, 2);
        assert.strictEqual(presentOnly.notificationSummary.processed, 0);
    } finally {
        if (originalAttendanceModule) require.cache[attendancePath] = originalAttendanceModule;
        else delete require.cache[attendancePath];
        if (originalServiceModule) require.cache[servicePath] = originalServiceModule;
        else delete require.cache[servicePath];
        if (originalControllerModule) require.cache[controllerPath] = originalControllerModule;
        else delete require.cache[controllerPath];
    }
}

async function testLegacyConsentHistoryDisplay() {
    const notificationPath = require.resolve('../models/ParentNotification');
    const studentPath = require.resolve('../models/Student');
    const controllerPath = require.resolve('../controllers/parentNotificationController');
    const originalNotificationModule = require.cache[notificationPath];
    const originalStudentModule = require.cache[studentPath];
    const originalControllerModule = require.cache[controllerPath];
    const legacyNotification = {
        _id: 'notification-legacy',
        eventType: 'absence',
        status: 'skipped',
        failureReason: 'SMS consent has not been provided',
        statusHistory: [],
        createdAt: new Date('2026-02-01T10:00:00Z'),
        attempts: 0,
        parentPhone: ''
    };
    const notificationModel = {
        find: () => ({
            sort() { return this; },
            limit() { return this; },
            select() { return this; },
            lean: async () => [legacyNotification]
        })
    };
    const studentModel = {
        find: () => ({
            select() { return this; },
            lean: async () => [{
                studentId: 'CS001',
                department: 'Computer Science',
                program: 'UG',
                year: '1',
                parentPhone: '919876543210'
            }]
        })
    };
    require.cache[notificationPath] = {
        id: notificationPath,
        filename: notificationPath,
        loaded: true,
        exports: notificationModel
    };
    require.cache[studentPath] = {
        id: studentPath,
        filename: studentPath,
        loaded: true,
        exports: studentModel
    };
    delete require.cache[controllerPath];

    try {
        const { listNotifications } = require('../controllers/parentNotificationController');
        const response = {
            statusCode: 0,
            body: null,
            status(code) {
                this.statusCode = code;
                return this;
            },
            json(body) {
                this.body = body;
                return this;
            }
        };
        await listNotifications({ query: {} }, response);
        assert.strictEqual(response.statusCode, 200);
        assert.strictEqual(
            response.body.notifications[0].failureReason,
            'Previously skipped under the legacy consent policy; it will not be sent automatically'
        );
        assert.strictEqual(
            response.body.notifications[0].statusHistory[0].reason,
            'SMS consent has not been provided',
            'The original skip reason remains visible as historical context'
        );
        assert.strictEqual(response.body.notifications[0].parentPhoneMasked, '91******3210');
        assert.strictEqual(Object.prototype.hasOwnProperty.call(response.body.notifications[0], 'parentPhone'), false);
    } finally {
        if (originalNotificationModule) require.cache[notificationPath] = originalNotificationModule;
        else delete require.cache[notificationPath];
        if (originalStudentModule) require.cache[studentPath] = originalStudentModule;
        else delete require.cache[studentPath];
        if (originalControllerModule) require.cache[controllerPath] = originalControllerModule;
        else delete require.cache[controllerPath];
    }
}

async function testLegacySkippedAbsenceResumesOnAttendanceSubmit() {
    const notificationPath = require.resolve('../models/ParentNotification');
    const studentPath = require.resolve('../models/Student');
    const msg91Path = require.resolve('../utils/msg91Service');
    const servicePath = require.resolve('../utils/parentNotificationService');
    const originalNotificationModule = require.cache[notificationPath];
    const originalStudentModule = require.cache[studentPath];
    const originalMsg91Module = require.cache[msg91Path];
    const originalServiceModule = require.cache[servicePath];
    const notification = {
        _id: 'notification-legacy',
        eventKey: 'absence:Computer Science:UG:1:CS001:2026-02-01',
        eventType: 'absence',
        attendanceRecordId: 'attendance-1',
        studentId: 'CS001',
        studentName: 'Student',
        parentName: 'Guardian',
        parentPhone: '',
        department: 'Computer Science',
        program: 'UG',
        year: '1',
        classId: 'CS1',
        attendanceDate: '2026-02-01',
        status: 'skipped',
        failureReason: 'Institutional parent SMS authorization is not enabled',
        attempts: 0,
        statusHistory: []
    };
    const notificationModel = {
        findOne: async () => notification,
        findOneAndUpdate: async (filter, update) => {
            if (notification.status !== filter.status || notification.attempts !== filter.attempts) return null;
            Object.assign(notification, update.$set);
            notification.statusHistory.push(...update.$push.statusHistory.$each);
            return notification;
        },
        findByIdAndUpdate: async (id, update) => {
            Object.assign(notification, update.$set);
            notification.attempts += update.$inc.attempts;
            notification.statusHistory.push(update.$push.statusHistory);
            return notification;
        }
    };
    const studentModel = {
        find: () => ({
            select() { return this; },
            lean: async () => [{
                studentId: 'CS001',
                studentName: 'Student',
                parentName: 'Guardian',
                parentPhone: '9876543210',
                parentSmsOptOut: false
            }]
        })
    };
    const sendCalls = [];
    require.cache[notificationPath] = {
        id: notificationPath,
        filename: notificationPath,
        loaded: true,
        exports: notificationModel
    };
    require.cache[studentPath] = {
        id: studentPath,
        filename: studentPath,
        loaded: true,
        exports: studentModel
    };
    require.cache[msg91Path] = {
        id: msg91Path,
        filename: msg91Path,
        loaded: true,
        exports: {
            sendFlowSms: async payload => {
                sendCalls.push(payload);
                return { messageId: 'mock-message-id' };
            }
        }
    };
    delete require.cache[servicePath];

    try {
        const { processAttendanceEvents } = require('../utils/parentNotificationService');
        const event = {
            eventType: 'absence',
            attendance: {
                _id: 'attendance-1',
                attendanceRecordId: 'attendance-1',
                studentId: 'CS001',
                studentName: 'Student',
                date: '2026-02-01',
                department: 'Computer Science',
                program: 'UG',
                year: '1',
                classId: 'CS1'
            }
        };
        await processAttendanceEvents([event]);
        await processAttendanceEvents([event]);

        assert.strictEqual(sendCalls.length, 1, 'A saved absence should send once, including a legacy skipped record on resubmission');
        assert.strictEqual(sendCalls[0].mobile, '919876543210');
        assert.strictEqual(notification.status, 'sent');
        assert.ok(notification.statusHistory.some(entry => entry.action === 'legacy_skip'));
        assert.ok(notification.statusHistory.some(entry => entry.action === 'attendance_submit_replay'));
    } finally {
        if (originalNotificationModule) require.cache[notificationPath] = originalNotificationModule;
        else delete require.cache[notificationPath];
        if (originalStudentModule) require.cache[studentPath] = originalStudentModule;
        else delete require.cache[studentPath];
        if (originalMsg91Module) require.cache[msg91Path] = originalMsg91Module;
        else delete require.cache[msg91Path];
        if (originalServiceModule) require.cache[servicePath] = originalServiceModule;
        else delete require.cache[servicePath];
    }
}

async function run() {
    assert.strictEqual(normalizeIndianMobile('9876543210'), '919876543210');
    assert.strictEqual(normalizeIndianMobile('+91 98765-43210'), '919876543210');
    assert.strictEqual(normalizeIndianMobile('09876543210'), '919876543210');
    assert.strictEqual(normalizeIndianMobile('12345'), null);
    assert.strictEqual(maskPhoneNumber('919876543210'), '91******3210');

    const attendance = {
        department: 'Computer Science',
        program: 'UG',
        year: '1',
        studentId: 'cs001',
        date: '2026-02-01',
        attendanceRecordId: 'attendance-123'
    };
    assert.strictEqual(buildEventKey('absence', attendance), 'CS001:attendance-123:absence');
    assert.notStrictEqual(
        buildEventKey('absence', attendance),
        buildEventKey('correction', attendance),
        'Different notification types must have different idempotency keys'
    );
    assert.notStrictEqual(
        buildEventKey('absence', attendance),
        buildEventKey('absence', { ...attendance, attendanceRecordId: 'attendance-456' }),
        'Different saved attendance records must have different idempotency keys'
    );

    assert.strictEqual(
        getSkipReason({ smsConsent: false, parentSmsOptOut: false, parentPhone: '9876543210' }),
        '',
        'The legacy per-student consent field must not block an otherwise eligible contact'
    );
    assert.strictEqual(
        getSkipReason({ parentPhone: '' }),
        'Parent mobile number missing'
    );
    assert.strictEqual(
        getSkipReason({ parentPhone: '12345' }),
        'Parent mobile number is invalid'
    );
    assert.strictEqual(
        getSkipReason({ parentSmsOptOut: true, parentPhone: '9876543210' }),
        'Parent opted out of attendance SMS'
    );
    const attendanceIdentityIndex = ParentNotification.schema.indexes().find(([keys, options]) =>
        keys.studentId === 1 &&
        keys.attendanceRecordId === 1 &&
        keys.eventType === 1 &&
        options.unique === true &&
        options.partialFilterExpression
    );
    assert.ok(attendanceIdentityIndex, 'A unique attendance notification identity index must exist');
    await testAttendanceNotificationSelection();
    await testLegacyConsentHistoryDisplay();
    await testLegacySkippedAbsenceResumesOnAttendanceSubmit();

    const originalFetch = global.fetch;
    const originalAuthKey = process.env.MSG91_AUTH_KEY;
    const originalAbsenceTemplateId = process.env.MSG91_ABSENCE_TEMPLATE_ID;
    const originalCorrectionTemplateId = process.env.MSG91_CORRECTION_TEMPLATE_ID;
    try {
        process.env.MSG91_AUTH_KEY = 'test-auth-key';
        process.env.MSG91_ABSENCE_TEMPLATE_ID = 'test-template';
        let capturedRequest;
        global.fetch = async (url, options) => {
            capturedRequest = { url, options };
            return {
                ok: true,
                status: 200,
                json: async () => ({ type: 'success', request_id: 'test-request-id' })
            };
        };

        const result = await sendFlowSms({
            mobile: '919876543210',
            parentName: 'Guardian',
            studentName: 'Student',
            attendanceDate: '2026-02-01',
            classId: 'CS1',
            eventType: 'absence'
        });
        assert.strictEqual(result.messageId, 'test-request-id');
        assert.strictEqual(capturedRequest.url, 'https://control.msg91.com/api/v5/flow/');
        assert.strictEqual(capturedRequest.options.headers.authkey, 'test-auth-key');
        const payload = JSON.parse(capturedRequest.options.body);
        assert.strictEqual(payload.template_id, 'test-template');
        assert.strictEqual(payload.recipients[0].mobiles, '919876543210');
        assert.strictEqual(payload.recipients[0].VAR2, 'Student');
        assert.strictEqual(payload.recipients[0].VAR4, 'CS1');

        global.fetch = async () => ({
            ok: true,
            status: 200,
            json: async () => ({ type: 'error' })
        });
        await assert.rejects(sendFlowSms({
            mobile: '919876543210',
            studentName: 'Student',
            attendanceDate: '2026-02-01',
            classId: 'CS1',
            eventType: 'absence'
        }), /MSG91 request failed/);
    } finally {
        global.fetch = originalFetch;
        if (originalAuthKey === undefined) delete process.env.MSG91_AUTH_KEY;
        else process.env.MSG91_AUTH_KEY = originalAuthKey;
        if (originalAbsenceTemplateId === undefined) delete process.env.MSG91_ABSENCE_TEMPLATE_ID;
        else process.env.MSG91_ABSENCE_TEMPLATE_ID = originalAbsenceTemplateId;
        if (originalCorrectionTemplateId === undefined) delete process.env.MSG91_CORRECTION_TEMPLATE_ID;
        else process.env.MSG91_CORRECTION_TEMPLATE_ID = originalCorrectionTemplateId;
    }
    console.log('Parent notification tests passed.');
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
