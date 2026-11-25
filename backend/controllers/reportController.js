const Student = require('../models/Student');
const Attendance = require('../models/Attendance');
const PeriodAttendance = require('../models/PeriodAttendance');
const { deleteFile } = require('../utils/gridFS');
const { sortStudentsByRollNumber } = require('../utils/rollNumberHelper');
const {
    getDailyAttendanceRecords,
    getPeriodAttendanceRecords,
    getUnifiedAttendanceRecords
} = require('../utils/attendanceData');

/**
 * Helper function to get year suffix (st, nd, rd, th)
 */
function getYearSuffix(year) {
    switch (String(year)) {
        case '1': return 'st';
        case '2': return 'nd';
        case '3': return 'rd';
        default: return 'th';
    }
}

/**
 * @desc    Generate daily attendance report across departments, programs and years
 * @route   GET /api/reports/daily
 * @access  Private (Admin or Staff)
 */
const getDailyReport = async (req, res) => {
    try {
        const { date, program } = req.query;

        // Validate date parameter
        if (!date) {
            return res.status(400).json({
                success: false,
                message: 'Date is required (YYYY-MM-DD format)'
            });
        }

        // Validate date format
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(date)) {
            return res.status(400).json({
                success: false,
                message: 'Date must be in YYYY-MM-DD format'
            });
        }

        let classConfigs;
        if (req.user.role === 'staff') {
            const department = String(req.user.department || '').trim();
            const year = String(req.user.year || '').trim();
            const staffProgram = String(req.user.program || '').trim().toUpperCase();
            const classId = String(req.user.classId || '').trim().toUpperCase();
            if (!department || !year || year === 'All' || !['UG', 'PG'].includes(staffProgram) || !classId) {
                return res.status(403).json({
                    success: false,
                    message: 'A valid assigned class is required to view this report.'
                });
            }
            classConfigs = [{ department, program: staffProgram, year, classId }];
        } else {
            const requestedProgram = program ? String(program).trim().toUpperCase() : 'ALL';
            if (!['UG', 'PG', 'ALL'].includes(requestedProgram)) {
                return res.status(400).json({ success: false, message: 'Program must be UG, PG, or ALL.' });
            }
            classConfigs = [];
            if (requestedProgram === 'UG' || requestedProgram === 'ALL') {
                classConfigs.push(
                    { department: 'Computer Science', program: 'UG', year: '1', classId: 'CS1' },
                    { department: 'Computer Science', program: 'UG', year: '2', classId: 'CS2' },
                    { department: 'Computer Science', program: 'UG', year: '3', classId: 'CS3' }
                );
            }
            if (requestedProgram === 'PG' || requestedProgram === 'ALL') {
                classConfigs.push(
                    { department: 'Computer Science', program: 'PG', year: '1', classId: 'PGCS1' },
                    { department: 'Computer Science', program: 'PG', year: '2', classId: 'PGCS2' }
                );
            }
        }

        const dailyReport = await Promise.all(classConfigs.map(async (scope, index) => {
            const studentFilter = {
                department: scope.department,
                program: scope.program,
                year: scope.year,
                classId: scope.classId,
                status: 'active'
            };
            const attendanceFilter = {
                department: scope.department,
                program: scope.program,
                year: scope.year,
                classId: scope.classId,
                date: date.trim()
            };
            const [students, dailyRecords, periodRecords] = await Promise.all([
                Student.find(studentFilter).select('studentId studentName').lean(),
                getDailyAttendanceRecords(attendanceFilter),
                getPeriodAttendanceRecords(attendanceFilter)
            ]);
            const studentNames = new Map(students.map(student => [
                String(student.studentId || '').trim().toUpperCase(),
                student.studentName || ''
            ]));
            const marks = [...dailyRecords, ...periodRecords];
            const presentCount = marks.filter(record => record.status === 'present').length;
            const absentRecords = marks.filter(record => record.status === 'absent');
            const absentStudents = absentRecords.map(record => ({
                studentId: String(record.studentId || '').trim().toUpperCase(),
                studentName: studentNames.get(String(record.studentId || '').trim().toUpperCase()) || record.studentName || '',
                classId: scope.classId,
                status: 'Absent',
                period: record.period || null
            }));
            const periodBreakdown = Array.from({ length: 5 }, (_, periodIndex) => {
                const period = periodIndex + 1;
                let periodMarks = periodRecords.filter(record => record.period === period);
                if (period === 1 && periodMarks.length === 0) {
                    periodMarks = dailyRecords;
                }
                return {
                    period,
                    status: periodMarks.length ? 'submitted' : 'pending',
                    present: periodMarks.filter(record => record.status === 'present').length,
                    absent: periodMarks.filter(record => record.status === 'absent').length,
                    total: periodMarks.length,
                    absentStudents: periodMarks.filter(record => record.status === 'absent').map(record => ({
                        studentId: String(record.studentId || '').trim().toUpperCase(),
                        studentName: studentNames.get(String(record.studentId || '').trim().toUpperCase()) || record.studentName || ''
                    }))
                };
            });
            const percentage = marks.length
                ? `${Math.round((presentCount / marks.length) * 100)}%`
                : 'No attendance recorded';

            return {
                serialNo: index + 1,
                department: scope.department,
                program: scope.program,
                year: scope.year,
                classId: scope.classId,
                classYear: `${scope.program} ${scope.year}${getYearSuffix(scope.year)} Year (${scope.classId})`,
                present: marks.length ? presentCount : 'No attendance recorded',
                absent: marks.length ? absentRecords.length : 'No attendance recorded',
                percentage,
                totalStudents: students.length,
                attendanceMode: dailyRecords.length && periodRecords.length
                    ? 'mixed'
                    : dailyRecords.length ? 'daily' : periodRecords.length ? 'period' : 'none',
                periodBreakdown,
                submittedPeriodsCount: periodBreakdown.filter(period => period.status === 'submitted').length,
                absentStudents
            };
        }));

        if (req.user.role === 'staff') {
            const report = dailyReport[0];
            const absentStudents = report.absentStudents
                .sort((left, right) => left.studentId.localeCompare(right.studentId, undefined, { numeric: true }))
                .map((student, index) => ({ serialNo: index + 1, ...student }));
            return res.status(200).json({
                success: true,
                date: date.trim(),
                department: report.department,
                program: report.program,
                year: report.year,
                classId: report.classId,
                totalStudents: report.totalStudents,
                presentCount: typeof report.present === 'number' ? report.present : 0,
                absentCount: absentStudents.length,
                absentStudents,
                periodBreakdown: report.periodBreakdown
            });
        }

        return res.status(200).json({
            success: true,
            date: date.trim(),
            reportData: dailyReport,
            totalClasses: dailyReport.length
        });

    } catch (error) {
        console.error('getDailyReport error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to generate daily report',
            error: error.message
        });
    }
};

/**
 * @desc    Generate attendance summary report for class within date range
 * @route   GET /api/reports/attendance
 * @access  Private
 */
const getAttendanceReport = async (req, res) => {
    try {
        const { department, year, program, classId, from, to } = req.query;

        const targetDept = (req.user.role === 'staff') ? req.user.department : (department || 'Computer Science');
        const targetYear = (req.user.role === 'staff' && req.user.year !== 'All') ? req.user.year : (year || '1');

        let targetProgram = 'UG';
        if (req.user.role === 'staff') {
            targetProgram = req.user.program || (req.user.classId && req.user.classId.startsWith('PG') ? 'PG' : 'UG');
        } else if (program) {
            targetProgram = String(program).trim().toUpperCase();
        } else if (classId && String(classId).trim().toUpperCase().startsWith('PG')) {
            targetProgram = 'PG';
        }

        const targetClassId = classId || (targetProgram === 'PG' ? `PGCS${targetYear}` : `CS${targetYear}`);

        if (!targetDept || !targetYear) {
            return res.status(400).json({
                success: false,
                message: 'Department and Year are required'
            });
        }

        if (!from || !to) {
            return res.status(400).json({
                success: false,
                message: 'Start date (from) and End date (to) are required (YYYY-MM-DD)'
            });
        }

        if (from > to) {
            return res.status(400).json({
                success: false,
                message: 'From date cannot be after To date'
            });
        }

        // 1. Fetch all enrolled active students in class
        const rawStudents = await Student.find({
            department: targetDept,
            program: targetProgram,
            year: targetYear,
            status: 'active'
        }).collation({ locale: 'en', numericOrdering: true }).sort({ studentId: 1 }).lean();

        const students = sortStudentsByRollNumber(rawStudents);

        if (students.length === 0) {
            return res.status(200).json({
                success: true,
                message: `No active students found for ${targetDept} (${targetProgram} Year ${targetYear})`,
                department: targetDept,
                year: targetYear,
                program: targetProgram,
                classId: targetClassId,
                totalStudents: 0,
                totalRecordedDays: 0,
                report: []
            });
        }

        // 2. Fetch all attendance records in date range
        const attendanceRecords = await getUnifiedAttendanceRecords({
            department: targetDept,
            program: targetProgram,
            year: targetYear,
            classId: targetClassId,
            date: { $gte: from.trim(), $lte: to.trim() }
        });

        const recordedDatesSet = new Set(attendanceRecords.map(record => record.date));
        const trackingUnits = new Set(attendanceRecords.map(record =>
            `${record.date}|${record.period || 'daily'}`
        ));

        // 4. Calculate individual student attendance metrics
        const report = students.map((s, idx) => {
            const sId = s.studentId.trim().toUpperCase();

            const studentRecords = attendanceRecords.filter(record =>
                String(record.studentId || '').trim().toUpperCase() === sId
            );

            const absentDays = studentRecords.filter(record => record.status === 'absent').length;
            const presentDays = studentRecords.filter(record => record.status === 'present').length;
            const studentDates = new Set(studentRecords.map(record => record.date));
            const percentage = studentRecords.length
                ? Math.round((presentDays / studentRecords.length) * 100)
                : 0;

            return {
                serial: idx + 1,
                studentId: s.studentId,
                studentName: s.studentName,
                totalDays: studentDates.size,
                totalRecords: studentRecords.length,
                totalPeriods: studentRecords.filter(record => record.period).length,
                present: presentDays,
                absent: absentDays,
                percentage
            };
        });

        res.status(200).json({
            success: true,
            department: targetDept,
            year: targetYear,
            program: targetProgram,
            classId: targetClassId,
            from,
            to,
            totalStudents: students.length,
            totalRecordedDays: recordedDatesSet.size,
            totalAttendanceRecords: trackingUnits.size,
            report
        });
    } catch (error) {
        console.error('getAttendanceReport error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to generate attendance report',
            error: error.message
        });
    }
};

/**
 * @desc    View all enrolled students for class (Student Data button in report)
 * @route   GET /api/reports/students
 * @access  Private
 */
const getClassStudents = async (req, res) => {
    try {
        const { department, year, program, classId } = req.query;

        const targetDept = (req.user.role === 'staff') ? req.user.department : (department || 'Computer Science');
        const targetYear = (req.user.role === 'staff' && req.user.year !== 'All') ? req.user.year : (year || '1');

        let targetProgram = 'UG';
        if (req.user.role === 'staff') {
            targetProgram = req.user.program || (req.user.classId && req.user.classId.startsWith('PG') ? 'PG' : 'UG');
        } else if (program) {
            targetProgram = String(program).trim().toUpperCase();
        } else if (classId && String(classId).trim().toUpperCase().startsWith('PG')) {
            targetProgram = 'PG';
        }

        const rawStudents = await Student.find({
            department: targetDept,
            program: targetProgram,
            year: targetYear,
            status: 'active'
        }).collation({ locale: 'en', numericOrdering: true }).sort({ studentId: 1 }).lean();

        const students = sortStudentsByRollNumber(rawStudents);
        students.forEach((s, idx) => {
            s.serial = idx + 1;
        });

        res.status(200).json({
            success: true,
            department: targetDept,
            year: targetYear,
            program: targetProgram,
            count: students.length,
            students
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve class student data',
            error: error.message
        });
    }
};

/**
 * @desc    Count students and attendance records for a class (Admin Only)
 * @route   GET /api/reports/class/summary
 * @access  Private (Admin Only)
 */
const getClassSummary = async (req, res) => {
    try {
        const department = String(req.query.department || '').trim();
        const rawYear = String(req.query.year || '').trim();
        const program = req.query.program ? String(req.query.program).trim().toUpperCase() : undefined;

        if (!department) {
            return res.status(400).json({
                success: false,
                message: 'Department is required'
            });
        }

        const filter = { department };
        if (rawYear && rawYear.toLowerCase() !== 'all') {
            filter.year = rawYear;
        }
        if (program) {
            filter.program = program;
        }

        const [studentCount, attendanceCount, periodAttendanceCounts] = await Promise.all([
            Student.countDocuments(filter),
            Attendance.countDocuments(filter),
            PeriodAttendance.aggregate([
                { $match: filter },
                { $unwind: '$records' },
                { $count: 'attendanceCount' }
            ])
        ]);
        const periodAttendanceCount = periodAttendanceCounts[0]?.attendanceCount || 0;

        res.status(200).json({
            success: true,
            department,
            year: filter.year || 'All',
            program: program || 'All',
            studentCount,
            attendanceCount: attendanceCount + periodAttendanceCount,
            dailyAttendanceCount: attendanceCount,
            periodAttendanceCount
        });
    } catch (error) {
        console.error('getClassSummary error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to load class summary',
            error: error.message
        });
    }
};

/**
 * @desc    Delete all students and attendance for a class (Admin Only)
 * @route   DELETE /api/reports/class
 * @access  Private (Admin Only)
 */
const deleteClassData = async (req, res) => {
    try {
        const body = req.body || {};
        const department = String(body.department || '').trim();
        const rawYear = String(body.year || '').trim();
        const program = body.program ? String(body.program).trim().toUpperCase() : undefined;

        if (!department) {
            return res.status(400).json({
                success: false,
                message: 'Department is required to delete class data'
            });
        }

        const deleteYear = rawYear && rawYear.toLowerCase() !== 'all' ? rawYear : null;

        const filter = { department };
        if (deleteYear) {
            filter.year = deleteYear;
        }
        if (program) {
            filter.program = program;
        }

        // Collect stored photos so they can be removed from GridFS too
        const studentsToDelete = await Student.find(filter).select('photoId').lean();
        const photoIds = studentsToDelete.map(s => s.photoId).filter(Boolean);

        const periodAttendanceCounts = await PeriodAttendance.aggregate([
            { $match: filter },
            { $unwind: '$records' },
            { $count: 'attendanceCount' }
        ]);
        const periodAttendanceCount = periodAttendanceCounts[0]?.attendanceCount || 0;
        const studentDeleteResult = await Student.deleteMany(filter);
        const attendanceDeleteResult = await Attendance.deleteMany(filter);
        const periodAttendanceDeleteResult = await PeriodAttendance.deleteMany(filter);

        for (const photoId of photoIds) {
            try {
                await deleteFile(photoId);
            } catch (photoError) {
                console.warn('Could not delete student photo:', photoId.toString(), photoError.message);
            }
        }

        const totalAttendanceCount = attendanceDeleteResult.deletedCount + periodAttendanceCount;
        const scopeText = `${department} ${program ? program + ' ' : ''}${deleteYear ? 'Year ' + deleteYear : '(all years)'}`;

        res.status(200).json({
            success: true,
            message: `Deleted ${studentDeleteResult.deletedCount} students, ${attendanceDeleteResult.deletedCount} daily attendance records, and ${periodAttendanceCount} period attendance records for ${scopeText}`,
            department,
            year: deleteYear || 'All',
            program: program || 'All',
            deletedStudents: studentDeleteResult.deletedCount,
            deletedAttendance: totalAttendanceCount,
            deletedDailyAttendance: attendanceDeleteResult.deletedCount,
            deletedPeriodRecords: periodAttendanceCount,
            deletedPeriodSessions: periodAttendanceDeleteResult.deletedCount
        });
    } catch (error) {
        console.error('deleteClassData error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete class data',
            error: error.message
        });
    }
};

module.exports = {
    getAttendanceReport,
    getClassStudents,
    deleteClassData,
    getClassSummary,
    getDailyReport
};
