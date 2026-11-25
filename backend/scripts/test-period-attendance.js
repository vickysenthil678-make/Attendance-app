const assert = require('assert');
const Attendance = require('../models/Attendance');
const PeriodAttendance = require('../models/PeriodAttendance');
const Student = require('../models/Student');
const attendanceController = require('../controllers/attendanceController');
const attendanceRoutes = require('../routes/attendanceRoutes');
const controller = require('../controllers/periodAttendanceController');
const reportController = require('../controllers/reportController');
const attendanceData = require('../utils/attendanceData');
const { enforceClassScope, requireRole } = require('../middleware/roleMiddleware');

function response() {
    return {
        statusCode: 200,
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
}

async function call(handler, req) {
    const res = response();
    await handler(req, res);
    return res;
}

async function runTests() {
    const RealDate = Date;
    let currentTestTime = new RealDate('2026-11-22T04:05:00.000Z');
    global.Date = class MockDate extends RealDate {
        constructor(...args) {
            super(...(args.length ? args : [currentTestTime.getTime()]));
        }

        static now() {
            return currentTestTime.getTime();
        }
    };

    const originalFindOne = PeriodAttendance.findOne;
    const originalFindOneAndUpdate = PeriodAttendance.findOneAndUpdate;
    const originalFind = PeriodAttendance.find;
    const originalStudentFind = Student.find;
    const originalStudentCountDocuments = Student.countDocuments;
    const originalAttendanceFind = Attendance.find;
    const originalAttendanceCollectionFind = Attendance.collection.find;
    const originalAttendanceBulkWrite = Attendance.bulkWrite;
    const originalStudentDeleteMany = Student.deleteMany;
    const originalAttendanceCountDocuments = Attendance.countDocuments;
    const originalAttendanceDeleteMany = Attendance.deleteMany;
    const originalPeriodAggregate = PeriodAttendance.aggregate;
    const originalPeriodDeleteMany = PeriodAttendance.deleteMany;
    let storedRecord = null;

    try {
        PeriodAttendance.findOne = () => ({
            lean: async () => storedRecord
        });
        PeriodAttendance.find = () => ({
            lean: async () => storedRecord ? [storedRecord] : [],
            select: () => ({
                lean: async () => storedRecord ? [storedRecord] : []
            })
        });
        Attendance.collection.find = () => ({ toArray: async () => [] });
        Student.find = () => ({
            select: () => ({
                lean: async () => [
                    { studentId: '26UCS001', studentName: 'Student One' },
                    { studentId: '26UCS002', studentName: 'Student Two' }
                ]
            })
        });
        PeriodAttendance.findOneAndUpdate = async (filter, update, options) => {
            const lockedCondition = filter.locked;
            if (lockedCondition && lockedCondition.$ne === true && storedRecord?.locked) {
                const error = new Error('Duplicate locked period');
                error.code = 11000;
                throw error;
            }
            if (filter.locked === true && !storedRecord?.locked) return null;
            if (options.upsert && !storedRecord) storedRecord = { ...update.$set };
            else if (storedRecord) storedRecord = { ...storedRecord, ...update.$set };
            return storedRecord;
        };

        assert(PeriodAttendance.schema.path('period'), 'period field is defined');
        assert(PeriodAttendance.schema.path('locked'), 'lock field is defined');
        assert(PeriodAttendance.schema.path('records'), 'per-student records are defined');
        assert.notStrictEqual(PeriodAttendance.collection.name, Attendance.collection.name, 'legacy daily records remain in a separate collection');
        assert(
            PeriodAttendance.schema.indexes().some(([index, options]) =>
                options.unique && index.date && index.classId && index.period
            ),
            'a class/date/period can have only one record'
        );
        assert(
            Attendance.schema.indexes().some(([index, options]) =>
                options.unique && options.partialFilterExpression?.period?.$type === 'null' && !index.period
            ),
            'daily attendance has its own duplicate-prevention index'
        );
        assert(
            Attendance.schema.indexes().some(([index, options]) =>
                options.unique && options.partialFilterExpression?.period?.$in?.length === 5 && index.period
            ),
            'legacy period attendance has a period-specific duplicate-prevention index'
        );

        const staffRequest = {
            user: {
                _id: 'staff-id',
                role: 'staff',
                department: 'Computer Science',
                program: 'UG',
                year: '1',
                classId: 'CS1'
            },
            body: {
                date: '2026-11-22',
                period: 1,
                records: [
                    { studentId: ' 26UCS002 ', studentName: 'Student Two', status: 'absent' },
                    { studentId: '26UCS001', studentName: 'Student One', status: 'present' }
                ]
            }
        };

        const invalidPeriod = await call(controller.markPeriodAttendance, {
            ...staffRequest,
            body: { ...staffRequest.body, period: 6 }
        });
        assert.strictEqual(invalidPeriod.statusCode, 400, 'periods outside 1-5 are rejected');

        const outsideWindow = await call(controller.markPeriodAttendance, {
            ...staffRequest,
            body: { ...staffRequest.body, period: 2 }
        });
        assert.strictEqual(outsideWindow.statusCode, 403, 'staff cannot submit a period outside its attendance window');

        currentTestTime = new RealDate('2026-11-22T04:15:00.000Z');
        const closedAtEnd = await call(controller.markPeriodAttendance, staffRequest);
        assert.strictEqual(closedAtEnd.statusCode, 403, 'period submission closes at the end of its time window');
        currentTestTime = new RealDate('2026-11-22T04:05:00.000Z');

        const duplicateStudent = await call(controller.markPeriodAttendance, {
            ...staffRequest,
            body: {
                ...staffRequest.body,
                records: [
                    { studentId: '26UCS001', status: 'present' },
                    { studentId: '26ucs001', status: 'absent' }
                ]
            }
        });
        assert.strictEqual(duplicateStudent.statusCode, 400, 'duplicate students are rejected');

        const unknownStudent = await call(controller.markPeriodAttendance, {
            ...staffRequest,
            body: {
                ...staffRequest.body,
                records: [
                    { studentId: '26UCS001', status: 'present' },
                    { studentId: '26UCS999', status: 'absent' }
                ]
            }
        });
        assert.strictEqual(unknownStudent.statusCode, 400, 'attendance for a student outside the active class is rejected');

        const incompleteRoster = await call(controller.markPeriodAttendance, {
            ...staffRequest,
            body: {
                ...staffRequest.body,
                records: [{ studentId: '26UCS001', status: 'present' }]
            }
        });
        assert.strictEqual(incompleteRoster.statusCode, 400, 'period cannot be locked with an incomplete roster');

        const crossClassResponse = response();
        let scopePassed = false;
        enforceClassScope({
            user: staffRequest.user,
            body: { classId: 'CS2' },
            query: {}
        }, crossClassResponse, () => { scopePassed = true; });
        assert.strictEqual(crossClassResponse.statusCode, 403, 'staff cannot mark another class');
        assert.strictEqual(scopePassed, false, 'cross-class request does not reach the controller');

        const unlockResponse = response();
        let unlockPassed = false;
        requireRole('admin')({ user: staffRequest.user }, unlockResponse, () => { unlockPassed = true; });
        assert.strictEqual(unlockResponse.statusCode, 403, 'staff cannot use the admin unlock action');
        assert.strictEqual(unlockPassed, false, 'staff unlock request is denied');

        const saved = await call(controller.markPeriodAttendance, staffRequest);
        assert.strictEqual(saved.statusCode, 200, 'staff can submit a valid period');
        assert.strictEqual(saved.body.record.locked, true, 'saved period is locked');
        assert.strictEqual(saved.body.record.records[0].studentId, '26UCS002', 'register numbers are normalized');
        assert.strictEqual(saved.body.record.records[0].status, 'absent', 'statuses are preserved');

        const blockedUpdate = await call(controller.markPeriodAttendance, staffRequest);
        assert.strictEqual(blockedUpdate.statusCode, 409, 'locked period cannot be overwritten by staff');

        const unlocked = await call(controller.unlockPeriodAttendance, {
            user: { _id: 'admin-id', role: 'admin' },
            body: { ...staffRequest.body, department: 'Computer Science', program: 'UG', year: '1', classId: 'CS1' }
        });
        assert.strictEqual(unlocked.statusCode, 200, 'admin can unlock a period');
        assert.strictEqual(unlocked.body.record.locked, false, 'unlock is persisted');

        currentTestTime = new RealDate('2026-11-22T08:30:00.000Z');
        const resubmitted = await call(controller.markPeriodAttendance, staffRequest);
        assert.strictEqual(resubmitted.statusCode, 200, 'staff can correct an admin-unlocked period outside its attendance window');
        assert.strictEqual(resubmitted.body.record.locked, true, 'resubmission locks the period again');

        const existing = await call(controller.getPeriodAttendance, {
            user: staffRequest.user,
            query: { date: '2026-11-22', period: '1' }
        });
        assert.strictEqual(existing.statusCode, 200, 'staff can retrieve their period state');
        assert.strictEqual(existing.body.record.locked, true, 'period state includes its lock status');

        const report = await call(controller.getPeriodReport, {
            user: staffRequest.user,
            query: { from: '2026-11-22', to: '2026-11-22' }
        });
        assert.strictEqual(report.statusCode, 200, 'staff can retrieve period reports for their own class');
        assert.strictEqual(report.body.periodSummary[0].records, 2, 'period report counts submitted records');
        assert.deepStrictEqual(
            report.body.periodSummary[0].absentStudents.map(student => [student.studentId, student.studentName]),
            [['26UCS002', 'Student Two']],
            'period report includes the absent students and their register numbers'
        );
        assert.strictEqual(report.body.report[0].totalPeriods, 1, 'student report counts recorded periods');

        const duplicateLegacyPeriod = {
            date: '2026-11-22',
            department: 'Computer Science',
            program: 'UG',
            year: '1',
            classId: 'CS1',
            period: 1,
            studentId: '26UCS001',
            studentName: 'Legacy Name',
            status: 'absent'
        };
        const legacyOnlyPeriod = {
            ...duplicateLegacyPeriod,
            studentId: '26UCS003',
            studentName: 'Legacy Student',
            status: 'absent'
        };
        storedRecord = {
            date: '2026-11-22',
            department: 'Computer Science',
            program: 'UG',
            year: '1',
            classId: 'CS1',
            period: 1,
            locked: true,
            records: [
                { studentId: '26UCS001', studentName: 'Student One', status: 'present' },
                { studentId: '26UCS002', studentName: 'Student Two', status: 'absent' }
            ]
        };
        Attendance.collection.find = filter => ({
            toArray: async () => filter.period && filter.period.$in
                ? [duplicateLegacyPeriod, legacyOnlyPeriod]
                : []
        });
        const mergedPeriods = await attendanceData.getPeriodAttendanceRecords({
            department: 'Computer Science',
            program: 'UG',
            year: '1',
            classId: 'CS1',
            date: '2026-11-22'
        });
        assert.strictEqual(mergedPeriods.length, 3, 'legacy and canonical period records merge without duplicate student marks');
        assert.strictEqual(
            mergedPeriods.find(record => record.studentId === '26UCS001').status,
            'present',
            'canonical PeriodAttendance wins over a duplicate legacy Attendance period'
        );
        assert(
            mergedPeriods.some(record => record.studentId === '26UCS003'),
            'legacy-only period history remains visible'
        );

        const mixedSession = {
            date: '2026-11-22',
            department: 'Computer Science',
            program: 'UG',
            year: '1',
            classId: 'CS1',
            period: 1,
            locked: true,
            records: [{ studentId: '26UCS002', studentName: 'Student Two', status: 'absent' }]
        };
        storedRecord = mixedSession;
        Student.find = () => ({
            select: () => ({
                lean: async () => [
                    { studentId: '26UCS001', studentName: 'Student One' },
                    { studentId: '26UCS002', studentName: 'Student Two' }
                ]
            })
        });
        Attendance.collection.find = filter => ({
            toArray: async () => filter.classId === 'CS1' && filter.period === null
                ? [{ ...duplicateLegacyPeriod, studentId: '26UCS001', status: 'present' }]
                : []
        });
        PeriodAttendance.find = filter => ({
            lean: async () => filter.classId === 'CS1' ? [mixedSession] : []
        });
        const adminDailyReport = await call(reportController.getDailyReport, {
            user: { role: 'admin' },
            query: { date: '2026-11-22', program: 'UG' }
        });
        assert.strictEqual(adminDailyReport.statusCode, 200, 'admin daily report combines both attendance collections');
        assert.strictEqual(adminDailyReport.body.reportData[0].attendanceMode, 'mixed', 'daily report identifies both attendance modes');
        assert.strictEqual(adminDailyReport.body.reportData[0].present, 1, 'daily report counts daily attendance from Attendance');
        assert.strictEqual(adminDailyReport.body.reportData[0].absent, 1, 'daily report counts period absence from PeriodAttendance');
        assert.strictEqual(adminDailyReport.body.reportData[0].percentage, '50%', 'daily report percentage uses recorded marks');
        assert.deepStrictEqual(
            adminDailyReport.body.reportData[0].absentStudents.map(student => [student.studentId, student.studentName, student.period]),
            [['26UCS002', 'Student Two', 1]],
            'admin report resolves absent student name and register number'
        );
        assert.strictEqual(adminDailyReport.body.reportData[0].periodBreakdown[0].absent, 1, 'period-wise totals remain available');

        const dailyRows = [];
        storedRecord = null;
        PeriodAttendance.find = () => ({
            lean: async () => [],
            select: () => ({ lean: async () => [] })
        });
        Attendance.find = filter => {
            const matches = dailyRows.filter(record =>
                record.date === filter.date &&
                record.department === filter.department &&
                record.year === filter.year &&
                record.program === filter.program &&
                record.period === null &&
                (!filter.studentId || (filter.studentId.$in
                    ? filter.studentId.$in.includes(record.studentId)
                    : filter.studentId === record.studentId))
            );
            return { select: () => ({ lean: async () => matches }) };
        };
        Attendance.bulkWrite = async operations => {
            operations.forEach(operation => {
                const { filter, update } = operation.updateOne;
                let record = dailyRows.find(item =>
                    item.studentId === filter.studentId &&
                    item.date === filter.date &&
                    item.department === filter.department &&
                    item.year === filter.year &&
                    item.program === filter.program &&
                    item.period === null
                );
                if (!record) {
                    record = { ...filter };
                    dailyRows.push(record);
                }
                Object.assign(record, update.$set);
            });
        };
        Attendance.collection.find = filter => ({
            toArray: async () => dailyRows.filter(record =>
                record.date === filter.date &&
                record.department === filter.department &&
                record.year === filter.year &&
                record.program === filter.program &&
                record.period === null
            )
        });
        const dailySaved = await call(attendanceController.markAttendance, {
            user: staffRequest.user,
            body: {
                date: '2026-11-22',
                department: 'Computer Science',
                program: 'UG',
                year: '1',
                classId: 'CS1',
                records: [
                    { studentId: '26UCS001', studentName: 'Student One', status: 'present' },
                    { studentId: '26UCS002', studentName: 'Student Two', status: 'present' }
                ]
            }
        });
        assert.strictEqual(dailySaved.statusCode, 200, 'daily attendance can be saved through the centralized API');
        assert(dailyRows.every(record => record.period === null), 'daily marks are isolated from period marks');
        const dailyRead = await call(attendanceController.getAttendance, {
            user: staffRequest.user,
            query: { date: '2026-11-22' }
        });
        assert.strictEqual(dailyRead.body.records.length, 2, 'mobile and website daily reads share the daily collection');

        storedRecord = null;
        PeriodAttendance.find = filter => ({
            lean: async () => filter.classId === 'CS1' && storedRecord ? [storedRecord] : [],
            select: () => ({ lean: async () => filter.classId === 'CS1' && storedRecord ? [storedRecord] : [] })
        });
        currentTestTime = new RealDate('2026-11-22T04:05:00.000Z');
        const markRoute = attendanceRoutes.stack.find(layer => layer.route && layer.route.path === '/mark');
        const dispatchMark = markRoute.route.stack[markRoute.route.stack.length - 1].handle;
        const websitePeriodSave = await call((req, res) => dispatchMark(req, res), {
            user: staffRequest.user,
            body: { ...staffRequest.body }
        });
        assert.strictEqual(websitePeriodSave.statusCode, 200, 'website period submission uses the centralized period writer');
        const mobilePeriodRead = await call(controller.getPeriodAttendance, {
            user: staffRequest.user,
            query: { date: '2026-11-22', period: '1' }
        });
        assert.strictEqual(mobilePeriodRead.body.record.records.length, 2, 'mobile period read sees the website period submission');

        let dailyStudentFilter;
        let dailyAttendanceFilter;
        Student.find = filter => {
            dailyStudentFilter = filter;
            return {
                select: () => ({
                    lean: async () => [
                        { studentId: '26UCS001', studentName: 'Student One' },
                        { studentId: '26UCS002', studentName: 'Student Two' }
                    ]
                })
            };
        };
        storedRecord = null;
        PeriodAttendance.find = () => ({
            lean: async () => [],
            select: () => ({ lean: async () => [] })
        });
        Attendance.collection.find = filter => {
            if (filter.period === null) dailyAttendanceFilter = filter;
            return {
                toArray: async () => filter.period === null ? [
                    { studentId: '26UCS001', studentName: 'Student One', status: 'present', date: '2026-11-22' },
                    { studentId: '26UCS002', studentName: 'Student Two', status: 'absent', date: '2026-11-22' }
                ] : []
            };
        };
        Attendance.find = filter => {
            return {
                select: () => ({
                    lean: async () => [
                        { studentId: '26UCS001', studentName: 'Student One', status: 'present' },
                        { studentId: '26UCS002', studentName: 'Student Two', status: 'absent' }
                    ]
                })
            };
        };
        const dailyReport = await call(reportController.getDailyReport, {
            user: staffRequest.user,
            query: { date: '2026-11-22', classId: 'CS2' }
        });
        assert.strictEqual(dailyReport.statusCode, 200, 'staff can load the daily absent-student report');
        assert.strictEqual(dailyStudentFilter.classId, 'CS1', 'daily report roster is scoped to the assigned class');
        assert.strictEqual(dailyAttendanceFilter.classId, 'CS1', 'daily report records ignore a requested class override');
        assert.strictEqual(dailyReport.body.totalStudents, 2, 'daily report counts the assigned class roster');
        assert.strictEqual(dailyReport.body.presentCount, 1, 'daily report counts present attendance records');
        assert.strictEqual(dailyReport.body.absentCount, 1, 'daily report counts absent attendance records');
        assert.strictEqual(dailyAttendanceFilter.classId, 'CS1', 'daily report reads records only for the assigned class');
        assert.deepStrictEqual(
            dailyReport.body.absentStudents.map(student => [student.studentId, student.status]),
            [['26UCS002', 'Absent']],
            'daily report returns absent students only'
        );

        Student.countDocuments = async () => 2;
        Attendance.countDocuments = async () => 3;
        PeriodAttendance.aggregate = async () => [{ attendanceCount: 6 }];
        const summary = await call(reportController.getClassSummary, {
            user: { role: 'admin' },
            query: { department: 'Computer Science', program: 'UG', year: '1' }
        });
        assert.strictEqual(summary.body.attendanceCount, 9, 'class preview counts legacy and period attendance records');
        assert.strictEqual(summary.body.periodAttendanceCount, 6, 'class preview reports period records separately');

        Student.find = () => ({ select: () => ({ lean: async () => [] }) });
        Student.deleteMany = async () => ({ deletedCount: 2 });
        Attendance.deleteMany = async () => ({ deletedCount: 3 });
        PeriodAttendance.deleteMany = async () => ({ deletedCount: 2 });
        const deleted = await call(reportController.deleteClassData, {
            user: { role: 'admin' },
            body: { department: 'Computer Science', program: 'UG', year: '1' }
        });
        assert.strictEqual(deleted.body.deletedAttendance, 9, 'class deletion counts legacy and period attendance entries');
        assert.strictEqual(deleted.body.deletedPeriodRecords, 6, 'class deletion reports period entries');

        console.log('Period attendance tests passed.');
    } finally {
        PeriodAttendance.findOne = originalFindOne;
        PeriodAttendance.findOneAndUpdate = originalFindOneAndUpdate;
        PeriodAttendance.find = originalFind;
        Student.find = originalStudentFind;
        Student.countDocuments = originalStudentCountDocuments;
        Attendance.find = originalAttendanceFind;
        Attendance.collection.find = originalAttendanceCollectionFind;
        Attendance.bulkWrite = originalAttendanceBulkWrite;
        Student.deleteMany = originalStudentDeleteMany;
        Attendance.countDocuments = originalAttendanceCountDocuments;
        Attendance.deleteMany = originalAttendanceDeleteMany;
        PeriodAttendance.aggregate = originalPeriodAggregate;
        PeriodAttendance.deleteMany = originalPeriodDeleteMany;
        global.Date = RealDate;
    }
}

runTests().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
