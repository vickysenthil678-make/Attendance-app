const Attendance = require('../models/Attendance');
const PeriodAttendance = require('../models/PeriodAttendance');

const VALID_PERIODS = [1, 2, 3, 4, 5];

function attendanceKey(record) {
    return [
        record.date,
        record.department,
        record.program,
        record.year,
        record.classId,
        record.period,
        String(record.studentId || '').trim().toUpperCase()
    ].join('|');
}

function normalizePeriodRecord(record, period, scope = {}) {
    return {
        ...scope,
        date: record.date || scope.date,
        department: record.department || scope.department,
        program: record.program || scope.program,
        year: String(record.year || scope.year || ''),
        classId: record.classId || scope.classId,
        period: Number(record.period || period),
        studentId: String(record.studentId || record.id || '').trim().toUpperCase(),
        studentName: String(record.studentName || record.name || '').trim(),
        status: record.status,
        recordedBy: record.recordedBy,
        attendanceMode: 'period'
    };
}

async function getDailyAttendanceRecords(filter) {
    return Attendance.collection.find({ ...filter, period: null }).toArray();
}

async function getPeriodAttendanceRecords(filter) {
    const legacyFilter = {
        ...filter,
        period: filter.period === undefined ? { $in: VALID_PERIODS } : filter.period
    };
    const [legacyRecords, periodSessions] = await Promise.all([
        Attendance.collection.find(legacyFilter).toArray(),
        PeriodAttendance.find(filter).lean()
    ]);

    const recordsByKey = new Map();
    legacyRecords.forEach((record) => {
        const normalized = normalizePeriodRecord(record, record.period);
        if (normalized.studentId && VALID_PERIODS.includes(normalized.period)) {
            recordsByKey.set(attendanceKey(normalized), normalized);
        }
    });

    periodSessions.forEach((session) => {
        (session.records || []).forEach((record) => {
            const normalized = normalizePeriodRecord(record, session.period, session);
            if (normalized.studentId && VALID_PERIODS.includes(normalized.period)) {
                recordsByKey.set(attendanceKey(normalized), {
                    ...normalized,
                    attendanceMode: 'period',
                    locked: session.locked,
                    recordedBy: session.recordedBy
                });
            }
        });
    });

    return [...recordsByKey.values()].sort((left, right) =>
        left.date.localeCompare(right.date) ||
        left.period - right.period ||
        left.studentId.localeCompare(right.studentId, undefined, { numeric: true })
    );
}

async function getPeriodAttendanceSession(scope) {
    const [session, records] = await Promise.all([
        PeriodAttendance.findOne(scope).lean(),
        getPeriodAttendanceRecords(scope)
    ]);
    if (!session && records.length === 0) return null;

    const sessionRecords = session ? session.records || [] : [];
    const recordsByStudentId = new Map(
        sessionRecords.map((record) => [
            String(record.studentId).trim().toUpperCase(),
            record
        ])
    );
    records.forEach((record) => {
        if (!recordsByStudentId.has(record.studentId)) {
            recordsByStudentId.set(record.studentId, record);
        }
    });

    return {
        ...(session || scope),
        records: [...recordsByStudentId.values()],
        locked: session ? session.locked : true,
        legacy: !session
    };
}

async function getUnifiedAttendanceRecords(filter) {
    const [dailyRecords, periodRecords] = await Promise.all([
        getDailyAttendanceRecords(filter),
        getPeriodAttendanceRecords(filter)
    ]);

    return [
        ...dailyRecords.map((record) => ({ ...record, period: null, attendanceMode: 'daily' })),
        ...periodRecords
    ];
}

module.exports = {
    VALID_PERIODS,
    getDailyAttendanceRecords,
    getPeriodAttendanceRecords,
    getPeriodAttendanceSession,
    getUnifiedAttendanceRecords
};
