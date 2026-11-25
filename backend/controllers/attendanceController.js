const Attendance = require('../models/Attendance');
const Student = require('../models/Student');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const { processAttendanceEvents } = require('../utils/parentNotificationService');
const {
    getDailyAttendanceRecords,
    getPeriodAttendanceRecords
} = require('../utils/attendanceData');

function isValidAttendanceDate(date) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const parsedDate = new Date(`${date}T00:00:00.000Z`);
    return !Number.isNaN(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === date;
}

async function notifyAttendanceEvents(events) {
    if (events.length === 0) return { processed: 0, failed: 0, skipped: 0 };
    try {
        return await processAttendanceEvents(events);
    } catch (error) {
        console.error('Parent notification processing failed after attendance was saved:', error);
        return {
            processed: 0,
            failed: 0,
            skipped: 0,
            warning: 'Attendance was saved, but parent notifications could not be processed.'
        };
    }
}

/**
 * @desc    Get attendance records for a specific date and class
 * @route   GET /api/attendance
 * @access  Private
 */
const getAttendance = async (req, res) => {
    try {
        const { date, department, year, program, classId } = req.query;

        if (!isValidAttendanceDate(date)) {
            return res.status(400).json({
                success: false,
                message: 'Attendance date must be a valid YYYY-MM-DD date'
            });
        }

        const targetDept = (req.user.role === 'staff') ? req.user.department : (department || req.user.department || 'Computer Science');
        const targetYear = (req.user.role === 'staff' && req.user.year !== 'All') ? req.user.year : (year || '1');

        let targetProgram;
        if (req.user.role === 'staff') {
            targetProgram = req.user.program || (req.user.classId && req.user.classId.startsWith('PG') ? 'PG' : 'UG');
        } else if (program) {
            targetProgram = String(program).trim().toUpperCase();
        } else if (classId && String(classId).trim().toUpperCase().startsWith('PG')) {
            targetProgram = 'PG';
        }

        const filter = {
            date: date.trim(),
            department: targetDept,
            year: targetYear
        };

        if (targetProgram) {
            filter.program = targetProgram;
        }

        if (req.user.role === 'staff') {
            filter.classId = req.user.classId ||
                (targetProgram === 'PG' ? `PGCS${targetYear}` : `CS${targetYear}`);
        } else if (classId) {
            filter.classId = String(classId).trim().toUpperCase();
        }

        const period = Number(req.query.period);
        const hasPeriod = req.query.period !== undefined && req.query.period !== '';
        if (hasPeriod && (!Number.isInteger(period) || period < 1 || period > 5)) {
            return res.status(400).json({
                success: false,
                message: 'Period must be an integer from 1 to 5.'
            });
        }
        const periodRecords = hasPeriod ? await getPeriodAttendanceRecords(filter) : [];
        const records = hasPeriod
            ? periodRecords.filter(record => record.period === period)
            : await getDailyAttendanceRecords(filter);
        const periodsByNumber = new Map();
        periodRecords.forEach(record => {
            const summary = periodsByNumber.get(record.period) || { period: record.period, present: 0, absent: 0 };
            summary[record.status] += 1;
            periodsByNumber.set(record.period, summary);
        });

        res.status(200).json({
            success: true,
            date,
            department: targetDept,
            year: targetYear,
            program: targetProgram || 'UG',
            classId: filter.classId,
            period: hasPeriod ? period : null,
            count: records.length,
            records,
            submittedPeriods: [...periodsByNumber.values()].sort((left, right) => left.period - right.period)
        });
    } catch (error) {
        console.error('getAttendance error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve attendance records',
            error: error.message
        });
    }
};

/**
 * @desc    Mark or update attendance (batch or individual)
 * @route   POST /api/attendance/mark
 * @access  Private
 */
const markAttendance = async (req, res) => {
    try {
        const { date, department, year, program, classId, records, studentId, status } = req.body;

        if (!isValidAttendanceDate(date)) {
            return res.status(400).json({
                success: false,
                message: 'Attendance date must be a valid YYYY-MM-DD date'
            });
        }

        const targetDept = (req.user.role === 'staff') ? req.user.department : (department || req.user.department || 'Computer Science');
        const targetYear = (req.user.role === 'staff' && req.user.year !== 'All') ? req.user.year : (year || '1');

        let targetProgram = 'UG';
        if (req.user.role === 'staff') {
            targetProgram = req.user.program || (req.user.classId && req.user.classId.startsWith('PG') ? 'PG' : 'UG');
        } else if (program) {
            targetProgram = String(program).trim().toUpperCase();
        } else if (classId && String(classId).trim().toUpperCase().startsWith('PG')) {
            targetProgram = 'PG';
        }

        const targetClassId = req.user.role === 'staff'
            ? (req.user.classId || (targetProgram === 'PG' ? `PGCS${targetYear}` : `CS${targetYear}`))
            : (classId || (targetProgram === 'PG' ? `PGCS${targetYear}` : `CS${targetYear}`));
        const sfx = targetYear === '1' ? '1st' : targetYear === '2' ? '2nd' : targetYear === '3' ? '3rd' : `${targetYear}th`;
        const academicYear = `${sfx} Year`;

        // Case A: Batch save (array of records)
        if (Array.isArray(records)) {
            const submittedRecords = records.map(rec => {
                const sId = String(rec.studentId || rec.id || '').trim().toUpperCase();
                const sStatus = rec.status === 'absent' ? 'absent' : 'present';
                return {
                    studentId: sId,
                    studentName: rec.studentName || rec.name || '',
                    status: sStatus
                };
            }).filter(record => record.studentId);

            const studentIds = [...new Set(submittedRecords.map(record => record.studentId))];
            const previousRecords = studentIds.length
                ? await Attendance.find({
                    studentId: { $in: studentIds },
                    date: date.trim(),
                    department: targetDept,
                    year: targetYear,
                    program: targetProgram,
                    period: null
                }).select('_id studentId status').lean()
                : [];
            const previousStatusById = new Map(previousRecords.map(record => [record.studentId, record.status]));

            const bulkOps = submittedRecords.map(rec => {
                return {
                    updateOne: {
                        filter: {
                            studentId: rec.studentId,
                            date: date.trim(),
                            department: targetDept,
                            year: targetYear,
                            program: targetProgram,
                            period: null
                        },
                        update: {
                            $set: {
                                status: rec.status,
                                studentName: rec.studentName,
                                program: targetProgram,
                                academicYear: academicYear,
                                classId: targetClassId,
                                period: null,
                                recordedBy: req.user._id
                            }
                        },
                        upsert: true
                    }
                };
            });

            if (bulkOps.length > 0) {
                await Attendance.bulkWrite(bulkOps);
            }

            const savedRecords = studentIds.length
                ? await Attendance.find({
                    studentId: { $in: studentIds },
                    date: date.trim(),
                    department: targetDept,
                    year: targetYear,
                    program: targetProgram,
                    period: null
                }).select('_id studentId status').lean()
                : [];
            const savedRecordByStudentId = new Map(savedRecords.map(record => [record.studentId, record]));

            const notificationEvents = submittedRecords.flatMap(record => {
                const savedRecord = savedRecordByStudentId.get(record.studentId);
                if (!savedRecord) return [];
                const attendanceRecord = {
                    ...record,
                    attendanceRecordId: savedRecord._id,
                    date: date.trim(),
                    department: targetDept,
                    year: targetYear,
                    program: targetProgram,
                    classId: targetClassId
                };
                if (record.status === 'absent') {
                    return [{ eventType: 'absence', attendance: attendanceRecord }];
                }
                if (previousStatusById.get(record.studentId) === 'absent') {
                    return [{ eventType: 'correction', attendance: attendanceRecord }];
                }
                return [];
            });
            const notificationSummary = await notifyAttendanceEvents(notificationEvents);

            return res.status(200).json({
                success: true,
                message: `Attendance saved for ${bulkOps.length} students on ${date} (${targetProgram} ${academicYear})`,
                date,
                department: targetDept,
                year: targetYear,
                program: targetProgram,
                classId: targetClassId,
                notificationSummary
            });
        }

        // Case B: Single student mark/toggle
        if (studentId && status) {
            const normId = String(studentId).trim().toUpperCase();
            const normStatus = status === 'absent' ? 'absent' : 'present';
            const attendanceFilter = {
                studentId: normId,
                date: date.trim(),
                department: targetDept,
                year: targetYear,
                program: targetProgram,
                period: null
            };
            const previousRecord = await Attendance.findOne(attendanceFilter).select('status').lean();

            const record = await Attendance.findOneAndUpdate(
                attendanceFilter,
                {
                    status: normStatus,
                    program: targetProgram,
                    academicYear: academicYear,
                    classId: targetClassId,
                    period: null,
                    recordedBy: req.user._id
                },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );
            const notificationEvents = [];
            const attendanceRecord = {
                attendanceRecordId: record._id,
                studentId: normId,
                studentName: record.studentName || '',
                date: date.trim(),
                department: targetDept,
                year: targetYear,
                program: targetProgram,
                classId: targetClassId
            };
            if (normStatus === 'absent') {
                notificationEvents.push({ eventType: 'absence', attendance: attendanceRecord });
            } else if (previousRecord && previousRecord.status === 'absent') {
                notificationEvents.push({ eventType: 'correction', attendance: attendanceRecord });
            }
            const notificationSummary = await notifyAttendanceEvents(notificationEvents);

            return res.status(200).json({
                success: true,
                message: `Attendance updated for ${normId}: ${normStatus}`,
                record,
                notificationSummary
            });
        }

        return res.status(400).json({
            success: false,
            message: 'Provide either records array or studentId and status'
        });
    } catch (error) {
        console.error('markAttendance error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to record attendance',
            error: error.message
        });
    }
};

/**
 * @desc    Upload Excel with student details and attendance
 * @route   POST /api/attendance/upload
 * @access  Private (staff only)
 */
const uploadExcel = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No Excel file uploaded' });
        }
        const { department, year, program } = req.body;
        if (!department || !year) {
            return res.status(400).json({ success: false, message: 'Department and year are required' });
        }

        let targetProgram = 'UG';
        if (req.user.role === 'staff') {
            targetProgram = req.user.program || (req.user.classId && req.user.classId.startsWith('PG') ? 'PG' : 'UG');
        } else if (program) {
            targetProgram = String(program).trim().toUpperCase();
        }

        const sfx = year === '1' ? '1st' : year === '2' ? '2nd' : year === '3' ? '3rd' : `${year}th`;
        const academicYear = `${sfx} Year`;
        const targetClassId = targetProgram === 'PG' ? `PGCS${year}` : `CS${year}`;

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(req.file.path);
        const sheet = workbook.worksheets[0];
        const rows = sheet.getRows(2, sheet.rowCount - 1) || [];
        let insertedStudents = 0;
        let updatedStudents = 0;
        let insertedAttendance = 0;

        for (const row of rows) {
            if (!row) continue;
            const values = row.values.slice(1);
            const id = String(values[0] || '').trim();
            const name = String(values[1] || '').trim();
            const dateVal = values[2];
            const statusRaw = String(values[3] || '').trim().toLowerCase();
            const notes = String(values[4] || '').trim();
            if (!id) continue;

            let student = await Student.findOne({ studentId: id, department, year, program: targetProgram });
            if (student) {
                if (name && student.studentName !== name) {
                    await Student.updateOne({ _id: student._id }, { studentName: name });
                    updatedStudents++;
                }
            } else {
                student = await Student.create({
                    studentId: id,
                    studentName: name,
                    department,
                    year,
                    program: targetProgram,
                    academicYear,
                    classId: targetClassId
                });
                insertedStudents++;
            }

            const attDate = dateVal instanceof Date ? dateVal : new Date(dateVal);
            const status = statusRaw === 'absent' ? 'absent' : 'present';
            await Attendance.create({
                studentId: student._id,
                department,
                year,
                program: targetProgram,
                academicYear,
                classId: targetClassId,
                date: attDate,
                status,
                notes,
                recordedBy: req.user._id,
            });
            insertedAttendance++;
        }

        fs.unlink(req.file.path, err => { if (err) console.warn('Failed to delete upload', err); });
        res.json({
            success: true,
            message: 'Excel processed',
            stats: { insertedStudents, updatedStudents, insertedAttendance }
        });
    } catch (err) {
        console.error('uploadExcel error:', err);
        res.status(500).json({ success: false, message: 'Failed to process Excel', error: err.message });
    }
};

module.exports = {
    getAttendance,
    markAttendance,
    uploadExcel
};
