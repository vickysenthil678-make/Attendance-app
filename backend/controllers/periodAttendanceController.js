const PeriodAttendance = require('../models/PeriodAttendance');
const Student = require('../models/Student');
const {
    getPeriodAttendanceRecords,
    getPeriodAttendanceSession
} = require('../utils/attendanceData');

const INDIA_TIME_ZONE = 'Asia/Kolkata';
const indiaDateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: INDIA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
});
const PERIOD_ATTENDANCE_WINDOWS = {
    1: { start: 9 * 60 + 30, end: 9 * 60 + 45, label: '9:30 AM to 9:45 AM' },
    2: { start: 10 * 60 + 20, end: 10 * 60 + 30, label: '10:20 AM to 10:30 AM' },
    3: { start: 11 * 60 + 15, end: 11 * 60 + 25, label: '11:15 AM to 11:25 AM' },
    4: { start: 12 * 60 + 30, end: 12 * 60 + 40, label: '12:30 PM to 12:40 PM' },
    5: { start: 13 * 60 + 20, end: 13 * 60 + 30, label: '1:20 PM to 1:30 PM' }
};

function getIndiaDateAndMinutes(now = new Date()) {
    const parts = indiaDateTimeFormatter.formatToParts(now);
    const value = (type) => parts.find((part) => part.type === type)?.value;
    const hour = Number(value('hour'));
    const minute = Number(value('minute'));
    return {
        date: `${value('year')}-${value('month')}-${value('day')}`,
        minutes: hour * 60 + minute
    };
}

function isValidAttendanceDate(date) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const parsedDate = new Date(`${date}T00:00:00.000Z`);
    return !Number.isNaN(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === date;
}

function getScope(req, input) {
    const user = req.user || {};
    const rawDepartment = user.role === 'staff'
        ? user.department
        : (input.department || user.department || 'Computer Science');
    const department = typeof rawDepartment === 'string' ? rawDepartment.trim() : '';
    const year = user.role === 'staff' && user.year !== 'All'
        ? String(user.year)
        : String(input.year || '1');
    const program = user.role === 'staff'
        ? (user.program || (user.classId && user.classId.startsWith('PG') ? 'PG' : 'UG'))
        : String(input.program || (input.classId && String(input.classId).toUpperCase().startsWith('PG') ? 'PG' : 'UG')).toUpperCase();
    const assignedClassId = user.classId ||
        (department.toLowerCase().includes('information')
            ? `IT${year}`
            : department.toLowerCase().includes('computer')
                ? (program === 'PG' ? `PGCS${year}` : `CS${year}`)
                : `${department.trim().slice(0, 3).toUpperCase()}${year}`);
    const classId = String(user.role === 'staff' ? assignedClassId : (input.classId || assignedClassId))
        .trim()
        .toUpperCase();

    return { department, program, year, classId };
}

function hasValidScope(scope) {
    return Boolean(
        scope.department &&
        scope.year &&
        ['UG', 'PG'].includes(scope.program) &&
        scope.classId
    );
}

function parsePeriod(value) {
    const period = Number(value);
    return Number.isInteger(period) && period >= 1 && period <= 5 ? period : null;
}

function normalizeRecords(records) {
    if (!Array.isArray(records) || records.length === 0) {
        return { error: 'Attendance records are required for the selected period.' };
    }

    const seen = new Set();
    const normalized = [];
    for (const record of records) {
        if (!record || typeof record !== 'object') {
            return { error: 'Every attendance record must include a student register number and status.' };
        }
        const studentId = String(record && (record.studentId || record.id) || '').trim().toUpperCase();
        if (!studentId) return { error: 'Every attendance record must include a student register number.' };
        if (seen.has(studentId)) return { error: `Duplicate attendance record for ${studentId}.` };
        if (record.status !== 'present' && record.status !== 'absent') {
            return { error: `Attendance status for ${studentId} must be present or absent.` };
        }
        seen.add(studentId);
        normalized.push({
            studentId,
            studentName: String(record.studentName || record.name || '').trim(),
            status: record.status
        });
    }
    return { records: normalized };
}

function invalidDate(res) {
    return res.status(400).json({
        success: false,
        message: 'Attendance date must be a valid YYYY-MM-DD date'
    });
}

async function getPeriodAttendance(req, res) {
    const { date, period } = req.query;
    if (!isValidAttendanceDate(date)) return invalidDate(res);
    const validPeriod = parsePeriod(period);
    if (!validPeriod) {
        return res.status(400).json({ success: false, message: 'Period must be an integer from 1 to 5.' });
    }

    const scope = getScope(req, req.query);
    if (!hasValidScope(scope)) {
        return res.status(400).json({ success: false, message: 'A valid department, programme, year, and class are required.' });
    }
    try {
        const record = await getPeriodAttendanceSession({ ...scope, date, period: validPeriod });
        return res.json({ success: true, date, ...scope, period: validPeriod, record: record || null });
    } catch (error) {
        console.error('getPeriodAttendance error:', error);
        return res.status(500).json({ success: false, message: 'Failed to retrieve period attendance.' });
    }
}

async function getPeriodReport(req, res) {
    const { from, to } = req.query;
    if (!isValidAttendanceDate(from) || !isValidAttendanceDate(to)) {
        return res.status(400).json({
            success: false,
            message: 'From and To must be valid YYYY-MM-DD dates.'
        });
    }
    if (from > to) {
        return res.status(400).json({ success: false, message: 'From date cannot be after To date.' });
    }

    const scope = getScope(req, req.query);
    if (!hasValidScope(scope)) {
        return res.status(400).json({ success: false, message: 'A valid department, programme, year, and class are required.' });
    }
    try {
        const [records, activeStudents] = await Promise.all([
            getPeriodAttendanceRecords({
                ...scope,
                date: { $gte: from, $lte: to }
            }),
            Student.find({ ...scope, status: 'active' }).select('studentId studentName').lean()
        ]);
        const studentNameById = new Map(activeStudents.map((student) => [
            String(student.studentId || '').trim().toUpperCase(),
            student.studentName || ''
        ]));
        const students = new Map();
        const periodSummary = Array.from({ length: 5 }, (_, index) => ({
            period: index + 1,
            records: 0,
            present: 0,
            absent: 0,
            percentage: 0,
            absentStudents: []
        }));

        records.forEach((record) => {
            const summary = periodSummary[record.period - 1];
            summary.records += 1;
            summary[record.status] += 1;
            if (record.status === 'absent') {
                summary.absentStudents.push({
                    studentId: record.studentId,
                    studentName: record.studentName || studentNameById.get(record.studentId) || ''
                });
            }
            const current = students.get(record.studentId) || {
                studentId: record.studentId,
                studentName: record.studentName || studentNameById.get(record.studentId) || '',
                totalPeriods: 0,
                present: 0,
                absent: 0
            };
            current.totalPeriods += 1;
            current[record.status] += 1;
            if (!current.studentName) {
                current.studentName = record.studentName || studentNameById.get(record.studentId) || '';
            }
            students.set(record.studentId, current);
        });

        periodSummary.forEach((summary) => {
            summary.percentage = summary.records
                ? Math.round((summary.present / summary.records) * 100)
                : 0;
            summary.absentStudents.sort((left, right) =>
                left.studentId.localeCompare(right.studentId, undefined, { numeric: true })
            );
        });
        const report = [...students.values()]
            .sort((left, right) => left.studentId.localeCompare(right.studentId, undefined, { numeric: true }))
            .map((student, index) => ({
                serial: index + 1,
                ...student,
                percentage: student.totalPeriods
                    ? Math.round((student.present / student.totalPeriods) * 100)
                    : 0
            }));

        return res.json({
            success: true,
            ...scope,
            from,
            to,
            totalPeriods: new Set(records.map(record => `${record.date}|${record.period}`)).size,
            periodSummary,
            report
        });
    } catch (error) {
        console.error('getPeriodReport error:', error);
        return res.status(500).json({ success: false, message: 'Failed to generate period attendance report.' });
    }
}

async function markPeriodAttendance(req, res) {
    const { date } = req.body;
    if (!isValidAttendanceDate(date)) return invalidDate(res);
    const period = parsePeriod(req.body.period);
    if (!period) {
        return res.status(400).json({ success: false, message: 'Period must be an integer from 1 to 5.' });
    }

    const normalized = normalizeRecords(req.body.records);
    if (normalized.error) return res.status(400).json({ success: false, message: normalized.error });

    const scope = getScope(req, req.body);
    if (!hasValidScope(scope)) {
        return res.status(400).json({ success: false, message: 'A valid department, programme, year, and class are required.' });
    }

    try {
        if (req.user.role === 'staff') {
            const now = getIndiaDateAndMinutes();
            const window = PERIOD_ATTENDANCE_WINDOWS[period];
            const withinWindow = now.minutes >= window.start && now.minutes < window.end;
            if (date !== now.date || !withinWindow) {
                const unlockedRecord = await PeriodAttendance.findOne({
                    ...scope,
                    date,
                    period,
                    locked: false
                }).lean();
                if (!unlockedRecord) {
                    if (date !== now.date) {
                        return res.status(403).json({
                            success: false,
                            message: 'Staff can submit attendance only for the current date in India Standard Time.'
                        });
                    }
                    return res.status(403).json({
                        success: false,
                        message: `Period ${period} attendance can only be submitted from ${window.label} IST.`
                    });
                }
            }
        }

        const activeStudents = await Student.find({
            department: scope.department,
            program: scope.program,
            year: scope.year,
            classId: scope.classId,
            status: 'active'
        }).select('studentId studentName').lean();
        const studentById = new Map(activeStudents.map((student) => [
            String(student.studentId).trim().toUpperCase(),
            student
        ]));
        const submittedIds = new Set(normalized.records.map((record) => record.studentId));
        const unknownStudent = normalized.records.find((record) => !studentById.has(record.studentId));
        if (unknownStudent) {
            return res.status(400).json({
                success: false,
                message: `${unknownStudent.studentId} is not an active student in this class.`
            });
        }
        const missingStudent = [...studentById.keys()].find((studentId) => !submittedIds.has(studentId));
        if (missingStudent) {
            return res.status(400).json({
                success: false,
                message: 'Submit attendance for every active student in this class.'
            });
        }
        const records = normalized.records.map((record) => ({
            ...record,
            studentName: studentById.get(record.studentId).studentName || record.studentName
        }));
        const record = await PeriodAttendance.findOneAndUpdate(
            { ...scope, date, period, locked: { $ne: true } },
            {
                $set: {
                    ...scope,
                    date,
                    period,
                    records,
                    locked: true,
                    lockedAt: new Date(),
                    recordedBy: req.user._id || req.user.id,
                    unlockedAt: null,
                    unlockedBy: null
                }
            },
            { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
        );
        return res.json({
            success: true,
            message: `Period ${period} attendance saved and locked.`,
            record
        });
    } catch (error) {
        if (error && error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: `Period ${period} is locked. Ask an Admin to unlock it before making changes.`
            });
        }
        console.error('markPeriodAttendance error:', error);
        return res.status(500).json({ success: false, message: 'Failed to save period attendance.' });
    }
}

async function unlockPeriodAttendance(req, res) {
    const { date } = req.body;
    if (!isValidAttendanceDate(date)) return invalidDate(res);
    const period = parsePeriod(req.body.period);
    if (!period) {
        return res.status(400).json({ success: false, message: 'Period must be an integer from 1 to 5.' });
    }

    const scope = getScope(req, req.body);
    if (!hasValidScope(scope)) {
        return res.status(400).json({ success: false, message: 'A valid department, programme, year, and class are required.' });
    }
    try {
        let record = await PeriodAttendance.findOneAndUpdate(
            { ...scope, date, period, locked: true },
            {
                $set: {
                    locked: false,
                    unlockedAt: new Date(),
                    unlockedBy: req.user._id || req.user.id
                }
            },
            { new: true, runValidators: true }
        );
        if (!record) {
            const legacySession = await getPeriodAttendanceSession({ ...scope, date, period });
            if (legacySession && legacySession.legacy) {
                record = await PeriodAttendance.findOneAndUpdate(
                    { ...scope, date, period },
                    {
                        $set: {
                            ...scope,
                            date,
                            period,
                            records: legacySession.records,
                            locked: false,
                            unlockedAt: new Date(),
                            unlockedBy: req.user._id || req.user.id
                        }
                    },
                    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
                );
            }
        }
        if (!record) {
            return res.status(404).json({
                success: false,
                message: 'No locked attendance record was found for this class, date, and period.'
            });
        }
        return res.json({
            success: true,
            message: `Period ${period} attendance unlocked.`,
            record
        });
    } catch (error) {
        console.error('unlockPeriodAttendance error:', error);
        return res.status(500).json({ success: false, message: 'Failed to unlock period attendance.' });
    }
}

module.exports = {
    getPeriodAttendance,
    getPeriodReport,
    markPeriodAttendance,
    unlockPeriodAttendance
};
