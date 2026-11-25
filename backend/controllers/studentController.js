const XLSX = require('xlsx');
const { uploadFile, deleteFile, getFileStream } = require('../utils/gridFS');
const Student = require('../models/Student');
const Attendance = require('../models/Attendance');
const {
    compareRollNumbers,
    sortStudentsByRollNumber,
    resequenceClassSerials
} = require('../utils/rollNumberHelper');

const findCSStaffStudent = async (req, res) => {
    if (req.user.role === 'admin') {
        if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) {
            res.status(400).json({ success: false, message: 'Invalid student id format' });
            return null;
        }
        const adminStudent = await Student.findById(req.params.id);
        if (!adminStudent) res.status(404).json({ success: false, message: 'Student not found' });
        return adminStudent || null;
    }
    const assignedYear = String(req.user.year || '');
    const userProgram = req.user.program || (req.user.classId && req.user.classId.startsWith('PG') ? 'PG' : 'UG');
    const validYears = userProgram === 'PG' ? ['1', '2'] : ['1', '2', '3'];

    const isCSStaff = String(req.user.department || '').trim().toLowerCase() === 'computer science' &&
        validYears.includes(assignedYear);

    if (!isCSStaff) {
        res.status(403).json({
            success: false,
            message: 'Access denied: photo access is limited to authorized Computer Science staff'
        });
        return null;
    }

    if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) {
        res.status(400).json({ success: false, message: 'Invalid student id format' });
        return null;
    }

    const student = await Student.findById(req.params.id);
    if (!student) {
        res.status(404).json({ success: false, message: 'Student not found' });
        return null;
    }

    const studentProgram = student.program || (student.classId && student.classId.startsWith('PG') ? 'PG' : 'UG');
    const sameClass = String(student.department || '').trim().toLowerCase() === 'computer science' &&
        String(student.year) === assignedYear &&
        studentProgram === userProgram;

    if (!sameClass) {
        res.status(403).json({
            success: false,
            message: 'Access denied: you can only access photos for students in your assigned CS class'
        });
        return null;
    }

    return student;
};

const isStudentPhotoFile = file => {
    if (!file || !Buffer.isBuffer(file.buffer)) return false;
    if (file.mimetype === 'image/jpeg') {
        return file.buffer.length >= 3 &&
            file.buffer[0] === 0xff && file.buffer[1] === 0xd8 && file.buffer[2] === 0xff;
    }
    if (file.mimetype === 'image/png') {
        return file.buffer.length >= 8 &&
            file.buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }
    return false;
};

/**
 * @desc    Get Computer Science students — scoped by role.
 *          Admin: all three years (or a specific year via ?year=).
 *          CS Staff: strictly their own assigned year only.
 * @route   GET /api/students/allyears
 * @access  Private (Any Computer Science staff or Admin)
 */
const getAllYearsStudents = async (req, res) => {
    try {
        const filter = { status: 'active', department: 'Computer Science' };

        if (req.user.role === 'staff') {
            // Staff must be a CS staff member with an assigned year and program
            const assignedYear = String(req.user.year || '');
            const userProgram = req.user.program || (req.user.classId && req.user.classId.startsWith('PG') ? 'PG' : 'UG');
            const validYears = userProgram === 'PG' ? ['1', '2'] : ['1', '2', '3'];

            const isCSStaff = req.user.department &&
                              req.user.department.trim().toLowerCase().includes('computer') &&
                              validYears.includes(assignedYear);

            if (!isCSStaff) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied: only authorized Computer Science staff can view student data'
                });
            }

            // Hard-lock staff to their own program and year
            filter.year = assignedYear;
            filter.program = userProgram;
            filter.classId = req.user.classId ||
                (userProgram === 'PG' ? `PGCS${assignedYear}` : `CS${assignedYear}`);

        } else if (req.user.role === 'admin') {
            // Admin can filter by program and year
            if (req.query.program) {
                filter.program = String(req.query.program).trim().toUpperCase();
            }
            if (req.query.year) {
                filter.year = String(req.query.year).trim();
            }
            if (req.query.classId) {
                filter.classId = String(req.query.classId).trim().toUpperCase();
            }
        } else {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        const rawStudents = await Student.find(filter)
            .collation({ locale: 'en', numericOrdering: true })
            .sort({ program: 1, year: 1, studentId: 1 })
            .lean();

        const sortedStudents = sortStudentsByRollNumber(rawStudents);
        sortedStudents.forEach((s, idx) => { s.serial = idx + 1; });

        res.status(200).json({
            success: true,
            count: sortedStudents.length,
            students: sortedStudents
        });
    } catch (error) {
        console.error('getAllYearsStudents error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve students',
            error: error.message
        });
    }
};

/**
 * @desc    Get students filtered by department and year
 * @route   GET /api/students
 * @access  Private (Staff restricted to their own class, Admin unrestricted)
 */
const getStudents = async (req, res) => {
    try {
        let filter = { status: 'active' };

        if (req.user.role === 'staff') {
            filter.department = req.user.department;
            if (req.user.year && req.user.year !== 'All') {
                filter.year = req.user.year;
            }
            const userProgram = req.user.program || (req.user.classId && req.user.classId.startsWith('PG') ? 'PG' : 'UG');
            if (userProgram && userProgram !== 'All') {
                filter.program = userProgram;
            }
            filter.classId = req.user.classId ||
                (userProgram === 'PG' ? `PGCS${req.user.year}` : `CS${req.user.year}`);
        } else {
            // Admin can optionally filter
            if (req.query.department) {
                filter.department = req.query.department;
            }
            if (req.query.year) {
                filter.year = req.query.year;
            }
            if (req.query.program) {
                filter.program = String(req.query.program).trim().toUpperCase();
            }
            if (req.query.classId) {
                filter.classId = String(req.query.classId).trim().toUpperCase();
            }
        }

        const rawStudents = await Student.find(filter)
            .collation({ locale: 'en', numericOrdering: true })
            .sort({ department: 1, program: 1, year: 1, studentId: 1 })
            .lean();

        // Sort by roll number using natural numeric-aware ordering
        const sortedStudents = sortStudentsByRollNumber(rawStudents);

        // Normalize serial numbers to sequential 1-based index matching roll number order
        sortedStudents.forEach((s, idx) => {
            s.serial = idx + 1;
        });

        // Support pagination if requested
        if (req.query.page && req.query.limit) {
            const page = Math.max(1, parseInt(req.query.page, 10) || 1);
            const limit = Math.max(1, parseInt(req.query.limit, 10) || 10);
            const total = sortedStudents.length;
            const paginatedStudents = sortedStudents.slice((page - 1) * limit, page * limit);
            return res.status(200).json({
                success: true,
                count: paginatedStudents.length,
                total,
                page,
                totalPages: Math.ceil(total / limit),
                students: paginatedStudents
            });
        }

        res.status(200).json({
            success: true,
            count: sortedStudents.length,
            students: sortedStudents
        });
    } catch (error) {
        console.error('getStudents error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve students',
            error: error.message
        });
    }
};

/**
 * @desc    Add single student manually
 * @route   POST /api/students/register or POST /api/students
 * @access  Private
 */
const addStudent = async (req, res) => {
    try {
        const { studentName, studentId, serial, department, year, program, classId, academicYear: suppliedAcademicYear, email, phone, studentMobileNumber, dateOfBirth, address, parentName, parentGuardianName, parentPhone, parentGuardianMobileNumber, parentRelationship, gender, umisId, abcId, dayScholarHosteller } = req.body;

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

        const targetClassId = classId || ((targetProgram === 'PG') ? `PGCS${targetYear}` : `CS${targetYear}`);
        if (req.user.role === 'staff' && String(targetClassId).toUpperCase() !== String(req.user.classId || '').toUpperCase()) {
            return res.status(403).json({ success: false, message: 'Staff can only add students to their assigned class' });
        }
        const sfx = targetYear === '1' ? '1st' : targetYear === '2' ? '2nd' : targetYear === '3' ? '3rd' : `${targetYear}th`;
        const academicYear = `${sfx} Year`;

        if (!studentName || !studentId) {
            return res.status(400).json({
                success: false,
                message: 'Student name and Register Number/ID are required'
            });
        }

        const normId = studentId.trim().toUpperCase();

        // Check if student already exists in this class (program + department + year)
        const existing = await Student.findOne({
            studentId: normId,
            department: targetDept,
            year: targetYear,
            program: targetProgram
        });

        if (existing) {
            return res.status(400).json({
                success: false,
                message: `Student with Register Number '${normId}' already exists in ${targetDept} (${targetProgram} Year ${targetYear}). Duplicate roll numbers are not allowed.`
            });
        }

        const student = await Student.create({
            studentName: studentName.trim(),
            studentId: normId,
            serial: Number(serial) || 1,
            department: targetDept,
            year: targetYear,
            program: targetProgram,
            academicYear: suppliedAcademicYear || academicYear,
            classId: targetClassId,
            email: email ? email.trim() : undefined,
            phone: (studentMobileNumber || phone) ? (studentMobileNumber || phone).trim() : undefined,
            dateOfBirth: dateOfBirth || undefined,
            address: address ? address.trim() : undefined,
            parentName: (parentGuardianName || parentName) ? (parentGuardianName || parentName).trim() : undefined,
            parentPhone: (parentGuardianMobileNumber || parentPhone) ? (parentGuardianMobileNumber || parentPhone).trim() : undefined,
            parentRelationship: parentRelationship ? String(parentRelationship).trim() : '',
            umisId: umisId || '',
            abcId: abcId || '',
            dayScholarHosteller: dayScholarHosteller || '',
            gender: gender || '',
            status: 'active'
        });

        // Re-sequence class serials so stored serials match the ascending roll number sequence
        await resequenceClassSerials(Student, targetDept, targetYear, targetProgram);

        res.status(201).json({
            success: true,
            message: `Student registered successfully (${targetProgram} ${academicYear})`,
            student
        });
    } catch (error) {
        console.error('addStudent error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to register student',
            error: error.message
        });
    }
};

/**
 * @desc    Batch add students from JSON array (Client-side Excel parsed)
 * @route   POST /api/students/batch
 * @access  Private
 */
const batchAddStudents = async (req, res) => {
    try {
        const { students, department, year, program, classId } = req.body;

        if (!Array.isArray(students) || students.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No student data provided'
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

        const targetClassId = classId || ((targetProgram === 'PG') ? `PGCS${targetYear}` : `CS${targetYear}`);
        const sfx = targetYear === '1' ? '1st' : targetYear === '2' ? '2nd' : targetYear === '3' ? '3rd' : `${targetYear}th`;
        const academicYear = `${sfx} Year`;

        const lastStudent = await Student.findOne({ department: targetDept, year: targetYear, program: targetProgram })
            .sort({ serial: -1 })
            .select('serial')
            .lean();
        let nextSerial = (Number(lastStudent && lastStudent.serial) || 0) + 1;

        let createdCount = 0;

        for (let i = 0; i < students.length; i++) {
            const item = students[i];
            const sId = String(item.id || item.studentId || '').trim().toUpperCase();
            const sName = String(item.name || item.studentName || 'Unknown').trim();

            if (!sId && !sName) continue;

            const filter = {
                studentId: sId || `STU${i + 1}`,
                department: targetDept,
                year: targetYear,
                program: targetProgram
            };

            // Keep the existing serial when the sheet has no serial column
            let sSerial = Number(item.serial);
            if (!sSerial) {
                const existingStudent = await Student.findOne(filter).select('serial').lean();
                sSerial = Number(existingStudent && existingStudent.serial) || nextSerial++;
            }

            const update = {
                studentName: sName,
                serial: sSerial,
                program: targetProgram,
                academicYear: academicYear,
                classId: targetClassId,
                email: item.email,
                phone: item.phone,
                dateOfBirth: item.dateOfBirth,
                address: item.address,
                parentName: item.parentName,
                parentPhone: item.parentPhone,
                parentRelationship: item.parentRelationship,
                photo: item.photo,
                status: 'active'
            };

            // Remove undefined/null values to avoid overwriting with empty values
            Object.keys(update).forEach(key => {
                if (update[key] === undefined || update[key] === null || update[key] === '') {
                    delete update[key];
                }
            });

            const result = await Student.findOneAndUpdate(filter, update, {
                upsert: true,
                new: true,
                setDefaultsOnInsert: true
            });

            if (result) createdCount++;
        }

        // Re-sequence class serials so stored serials match the ascending roll number sequence
        await resequenceClassSerials(Student, targetDept, targetYear, targetProgram);

        res.status(200).json({
            success: true,
            message: `Successfully processed ${createdCount} students for ${targetDept} (${targetProgram} Year ${targetYear})`,
            count: createdCount
        });
    } catch (error) {
        console.error('batchAddStudents error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to batch import students',
            error: error.message
        });
    }
};

/**
 * @desc    Upload Excel file (.xlsx, .xls) and parse on server
 * @route   POST /api/students/upload
 * @access  Private
 */
const uploadExcel = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'Please attach an Excel file (.xlsx or .xls)'
            });
        }

        const targetDept = (req.user.role === 'staff')
            ? req.user.department
            : (req.body.department || req.user.department || 'Computer Science');

        const targetYear = (req.user.role === 'staff' && req.user.year !== 'All')
            ? req.user.year
            : (req.body.year || '1');

        let targetProgram = 'UG';
        if (req.user.role === 'staff') {
            targetProgram = req.user.program || (req.user.classId && req.user.classId.startsWith('PG') ? 'PG' : 'UG');
        } else if (req.body.program) {
            targetProgram = String(req.body.program).trim().toUpperCase();
        } else if (req.body.classId && String(req.body.classId).trim().toUpperCase().startsWith('PG')) {
            targetProgram = 'PG';
        }

        const targetClassId = req.body.classId || ((targetProgram === 'PG') ? `PGCS${targetYear}` : `CS${targetYear}`);
        const sfx = targetYear === '1' ? '1st' : targetYear === '2' ? '2nd' : targetYear === '3' ? '3rd' : `${targetYear}th`;
        const academicYear = `${sfx} Year`;

        if (!targetDept || !targetYear) {
            return res.status(400).json({
                success: false,
                message: 'Department and Year are required'
            });
        }

        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const firstSheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[firstSheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

        if (rows.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Uploaded Excel sheet is empty'
            });
        }

        const lastStudent = await Student.findOne({ department: targetDept, year: targetYear, program: targetProgram })
            .sort({ serial: -1 })
            .select('serial')
            .lean();
        let nextSerial = (Number(lastStudent && lastStudent.serial) || 0) + 1;

        let savedCount = 0;

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const keys = Object.keys(row);

            // Column match for Register No / ID
            const id = String(
                row['reg number']  || row['Reg Number']  || row['REG NUMBER']  ||
                row['regno']       || row['RegNo']       || row['Reg No']      ||
                row['reg no']      || row['register no'] || row['Register No'] ||
                row['studentId']   || row['StudentId']   || row['student id']  ||
                row['id']          || row['ID']          ||
                (keys[1] !== undefined ? row[keys[1]] : '') || ''
            ).trim().toUpperCase();

            // Column match for Name
            const name = String(
                row['bname']       || row['Bname']       || row['BNAME']       ||
                row['name']        || row['Name']        || row['NAME']        ||
                row['studentName'] || row['StudentName'] || row['student name']||
                row['Student Name']|| row['Student']     || row['student']     ||
                (keys[2] !== undefined ? row[keys[2]] : keys[1] !== undefined ? row[keys[1]] : '') || ''
            ).trim();

            // Optional fields - case-insensitive matching
            const email = row['email'] || row['Email'] || row['EMAIL'] || '';
            const phone = row['phone'] || row['Phone'] || row['PHONE'] || '';
            const dateOfBirth = row['date of birth'] || row['Date of Birth'] || row['Date of birth'] ||
                                row['dob'] || row['Dob'] || row['DOB'] || '';
            const address = row['address'] || row['Address'] || row['ADDRESS'] || '';
            const parentName = row['parent name'] || row['Parent Name'] || row['Parent name'] ||
                               row['father name'] || row['Father Name'] || row['Mother name'] ||
                               row['mother name'] || row['guardian name'] || '';
            const parentPhone = row['parent phone'] || row['Parent Phone'] ||
                                row['Parent phone'] || row['guardian phone'] || '';
            const parentRelationship = row['parent relationship'] || row['Parent Relationship'] ||
                                       row['relationship'] || row['Relationship'] || '';
            const photo = row['photo'] || row['Photo'] || row['PHOTO'] || row['photo_url'] || row['Photo URL'] || '';

            const serialVal = row['serial number'] || row['Serial Number'] ||
                              row['S.No'] || row['sno'] || row['Sno'] || row['S No'] || '';
            const parsedSerial = Number(serialVal);

            if (!id && !name) continue;

            let serialValue = parsedSerial;
            if (!serialValue) {
                const existingStudent = await Student.findOne({
                    studentId: id || `STU${i + 1}`,
                    department: targetDept,
                    year: targetYear,
                    program: targetProgram
                }).select('serial').lean();
                serialValue = Number(existingStudent && existingStudent.serial) || nextSerial++;
            }

            const updateData = {
                studentName: name || 'Unknown',
                serial: serialValue,
                program: targetProgram,
                academicYear: academicYear,
                classId: targetClassId,
                status: 'active'
            };

            // Only add optional fields if they have values
            if (email.trim()) updateData.email = email.trim();
            if (phone.trim()) updateData.phone = phone.trim();
            if (dateOfBirth.trim()) updateData.dateOfBirth = dateOfBirth.trim();
            if (address.trim()) updateData.address = address.trim();
            if (parentName.trim()) updateData.parentName = parentName.trim();
            if (parentPhone.trim()) updateData.parentPhone = parentPhone.trim();
            if (String(parentRelationship).trim()) updateData.parentRelationship = String(parentRelationship).trim();
            if (photo.trim()) updateData.photo = photo.trim();

            await Student.findOneAndUpdate(
                {
                    studentId: id || `STU${i + 1}`,
                    department: targetDept,
                    year: targetYear,
                    program: targetProgram
                },
                updateData,
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );

            savedCount++;
        }

        // Re-sequence class serials so stored serials match the ascending roll number sequence
        await resequenceClassSerials(Student, targetDept, targetYear, targetProgram);

        res.status(200).json({
            success: true,
            message: `Successfully uploaded and saved ${savedCount} students for ${targetDept} (${targetProgram} Year ${targetYear})`,
            count: savedCount,
            stats: {
                insertedStudents: savedCount,
                updatedStudents: 0,
                insertedAttendance: 0
            }
        });
    } catch (error) {
        console.error('uploadExcel error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to process Excel file',
            error: error.message
        });
    }
};

/**
 * @desc    Delete single student
 * @route   DELETE /api/students/:id
 * @access  Private (Admin or Staff)
 */
const deleteStudent = async (req, res) => {
    try {
        const studentId = String(req.params.id || '').trim();
        const body = req.body || {};
        const requestedDept = String(req.query.department || body.department || '').trim();
        const requestedYear = String(req.query.year || body.year || '').trim();
        const requestedProgram = String(req.query.program || body.program || '').trim().toUpperCase();

        const filter = studentId.match(/^[0-9a-fA-F]{24}$/)
            ? { _id: studentId }
            : { studentId: studentId.toUpperCase() };

        if (req.user.role === 'staff') {
            // Staff are always confined to their selected class.
            if (!req.user.year || req.user.year === 'All') {
                return res.status(403).json({
                    success: false,
                    message: 'Please select a class first'
                });
            }
            filter.department = req.user.department;
            filter.year = String(req.user.year);
            filter.program = req.user.program || (req.user.classId && req.user.classId.startsWith('PG') ? 'PG' : 'UG');
            if (req.user.classId) {
                filter.classId = req.user.classId;
            }
        } else {
            if (requestedDept) filter.department = requestedDept;
            if (requestedYear) filter.year = requestedYear;
            if (requestedProgram) filter.program = requestedProgram;
        }

        const matches = await Student.find(filter).limit(2);

        if (matches.length === 0) {
            return res.status(404).json({ success: false, message: 'Student not found in the selected class' });
        }

        if (matches.length > 1) {
            return res.status(409).json({
                success: false,
                message: 'This register number exists in more than one class. Specify department, year, and program to delete the correct record.'
            });
        }

        const student = matches[0];

        // Delete attendance for this exact student and class only
        await Attendance.deleteMany({
            $or: [
                {
                    studentId: student.studentId,
                    department: student.department,
                    year: student.year,
                    program: student.program || 'UG'
                },
                { student: student._id }
            ]
        });

        // Delete stored photo from GridFS if present
        if (student.photoId) {
            await deleteFile(student.photoId);
        }
        await Student.findByIdAndDelete(student._id);

        // Re-sequence remaining students in class
        await resequenceClassSerials(Student, student.department, student.year, student.program);

        res.status(200).json({
            success: true,
            message: `Student ${student.studentName} (${student.studentId}) and attendance records removed from ${student.department} (${student.program} Year ${student.year})`,
            deletedStudentId: student.studentId,
            department: student.department,
            year: student.year,
            program: student.program
        });
    } catch (error) {
        console.error('deleteStudent error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete student',
            error: error.message
        });
    }
};

/**
 * @desc    Get a single student by MongoDB _id
 * @route   GET /api/students/:id
 * @access  Private (Admin or Staff scoped to their own class)
 */
const getStudentById = async (req, res) => {
    try {
        const mongoId = req.params.id;
        if (!mongoId.match(/^[0-9a-fA-F]{24}$/)) {
            return res.status(400).json({ success: false, message: 'Invalid student id format' });
        }

        const student = await Student.findById(mongoId).lean();
        if (!student) {
            return res.status(404).json({ success: false, message: 'Student not found' });
        }

        // Staff may only access their own class
        if (req.user.role === 'staff') {
            const sameDept = student.department.trim().toLowerCase() === req.user.department.trim().toLowerCase();
            const userProgram = req.user.program || (req.user.classId && req.user.classId.startsWith('PG') ? 'PG' : 'UG');
            const assignedYear = String(req.user.year || '');
            const assignedClassId = req.user.classId ||
                (userProgram === 'PG' ? `PGCS${assignedYear}` : `CS${assignedYear}`);
            const sameYear = assignedYear !== 'All' && String(student.year) === assignedYear;
            const sameProgram = !userProgram || userProgram === 'All' || String(student.program || 'UG') === userProgram;
            const sameClass = String(student.classId || '').toUpperCase() === String(assignedClassId).toUpperCase();
            if (!sameDept || !sameYear || !sameProgram || !sameClass) {
                return res.status(403).json({ success: false, message: 'Access denied: student is not in your class' });
            }
        }

        res.status(200).json({ success: true, student });
    } catch (error) {
        console.error('getStudentById error:', error);
        res.status(500).json({ success: false, message: 'Failed to retrieve student', error: error.message });
    }
};

/**
 * @desc    Stream a student's photo to their assigned CS staff member
 * @route   GET /api/students/:id/photo
 */
const getStudentPhoto = async (req, res) => {
    try {
        const student = await findCSStaffStudent(req, res);
        if (!student) return;
        if (!student.photoId) {
            return res.status(404).json({ success: false, message: 'Student photo not found' });
        }

        res.set({
            'Content-Type': student.photoMimeType || 'image/jpeg',
            'Content-Disposition': 'inline',
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff'
        });

        const stream = getFileStream(student.photoId);
        stream.on('error', error => {
            console.error('getStudentPhoto stream error:', error);
            if (!res.headersSent) {
                res.status(404).json({ success: false, message: 'Student photo could not be read' });
            } else {
                res.destroy(error);
            }
        });
        stream.pipe(res);
    } catch (error) {
        console.error('getStudentPhoto error:', error);
        res.status(500).json({ success: false, message: 'Failed to retrieve student photo' });
    }
};

/**
 * @desc    Add or replace a student's photo for their assigned CS staff member
 * @route   PUT /api/students/:id/photo
 */
const uploadStudentPhoto = async (req, res) => {
    try {
        const student = await findCSStaffStudent(req, res);
        if (!student) return;
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Choose a JPG, JPEG, or PNG photo to upload' });
        }
        if (!isStudentPhotoFile(req.file)) {
            return res.status(400).json({ success: false, message: 'Only valid JPG, JPEG, and PNG images are permitted' });
        }

        const mimeType = req.file.mimetype;
        const extension = mimeType === 'image/png' ? 'png' : 'jpg';
        const previousPhotoId = student.photoId;
        const newPhotoId = await uploadFile(
            req.file.buffer,
            `student-${student._id}-${Date.now()}.${extension}`,
            mimeType
        );

        student.photoId = newPhotoId;
        student.photoMimeType = mimeType;
        student.photo = '';
        try {
            await student.save();
        } catch (error) {
            try {
                await deleteFile(newPhotoId);
            } catch (cleanupError) {
                console.warn('Could not remove unreferenced student photo:', cleanupError.message);
            }
            throw error;
        }

        let message = 'Student photo saved successfully';
        if (previousPhotoId) {
            try {
                await deleteFile(previousPhotoId);
            } catch (error) {
                console.warn('Could not delete replaced student photo:', error.message);
                message += '; the previous photo could not be cleaned up';
            }
        }

        res.status(200).json({
            success: true,
            message,
            photoId: newPhotoId,
            photoMimeType: mimeType
        });
    } catch (error) {
        console.error('uploadStudentPhoto error:', error);
        res.status(500).json({ success: false, message: 'Failed to save student photo' });
    }
};

/**
 * @desc    Remove a student's photo for their assigned CS staff member
 * @route   DELETE /api/students/:id/photo
 */
const deleteStudentPhoto = async (req, res) => {
    try {
        const student = await findCSStaffStudent(req, res);
        if (!student) return;

        const previousPhotoId = student.photoId;
        student.photoId = null;
        student.photoMimeType = '';
        student.photo = '';
        await student.save();

        let message = 'Student photo removed successfully';
        if (previousPhotoId) {
            try {
                await deleteFile(previousPhotoId);
            } catch (error) {
                console.warn('Could not delete removed student photo:', error.message);
                message += '; the stored file could not be cleaned up';
            }
        }

        res.status(200).json({ success: true, message });
    } catch (error) {
        console.error('deleteStudentPhoto error:', error);
        res.status(500).json({ success: false, message: 'Failed to remove student photo' });
    }
};

/**
 * @desc    Update single student details
 * @route   PUT /api/students/:id
 * @access  Private (Admin or Staff with edit rights)
 */
const updateStudent = async (req, res) => {
    try {
        const studentMongoId = req.params.id;
        const { studentName, studentId, department, year, program, classId, academicYear, email, phone, studentMobileNumber, dateOfBirth, address, parentName, parentGuardianName, parentPhone, parentGuardianMobileNumber, parentRelationship, gender, umisId, abcId, dayScholarHosteller, status } = req.body;

        const student = await Student.findById(studentMongoId);
        if (!student) {
            return res.status(404).json({ success: false, message: 'Student not found' });
        }

        if (req.user.role === 'staff') {
            const sameDept = student.department.trim().toLowerCase() === req.user.department.trim().toLowerCase();
            const sameYear = Boolean(req.user.year && req.user.year !== 'All' && String(student.year) === String(req.user.year));
            const userProgram = req.user.program || (req.user.classId && req.user.classId.startsWith('PG') ? 'PG' : 'UG');
            const sameProgram = !userProgram || userProgram === 'All' || String(student.program || 'UG') === userProgram;
            const assignedClassId = req.user.classId ||
                (userProgram === 'PG' ? `PGCS${req.user.year}` : `CS${req.user.year}`);
            const sameClass = String(student.classId || '').toUpperCase() === String(assignedClassId).toUpperCase();
            if (!sameDept || !sameYear || !sameProgram || !sameClass) {
                return res.status(403).json({ success: false, message: 'Access denied: student is not in your class' });
            }
        }

        if (req.body.photo !== undefined && String(req.body.photo) !== String(student.photo || '')) {
            return res.status(403).json({
                success: false,
                message: 'Use the staff Student Data photo controls to update a student photo'
            });
        }

        if (req.user.role === 'staff' && [studentId, department, year, program, classId].some(value => value !== undefined)) {
            return res.status(403).json({ success: false, message: 'Staff cannot change roll number, department, programme, year, or class assignment' });
        }
        const targetDept = department || student.department;
        const targetYear = year || student.year;
        const targetProgram = program ? String(program).trim().toUpperCase() : (student.program || 'UG');

        // If changing studentId, check for duplicate in same class
        if (studentId && studentId.trim().toUpperCase() !== student.studentId) {
            const normNewId = studentId.trim().toUpperCase();
            const existing = await Student.findOne({
                studentId: normNewId,
                department: targetDept,
                year: targetYear,
                program: targetProgram,
                _id: { $ne: studentMongoId }
            });
            if (existing) {
                return res.status(400).json({
                    success: false,
                    message: `Student with ID '${normNewId}' already exists in ${targetDept} (${targetProgram} Year ${targetYear})`
                });
            }
            student.studentId = normNewId;
        }

        if (studentName) student.studentName = studentName.trim();
        if (department) student.department = department;
        if (year) student.year = year;
        if (program) student.program = targetProgram;
        if (classId) {
            student.classId = classId;
        } else if (department || year || program) {
            student.classId = targetProgram === 'PG' ? `PGCS${targetYear}` : `CS${targetYear}`;
            const sfx = targetYear === '1' ? '1st' : targetYear === '2' ? '2nd' : targetYear === '3' ? '3rd' : `${targetYear}th`;
            student.academicYear = `${sfx} Year`;
        }
        if (email !== undefined) student.email = email;
        if (phone !== undefined || studentMobileNumber !== undefined) student.phone = studentMobileNumber !== undefined ? studentMobileNumber : phone;
        if (dateOfBirth !== undefined) student.dateOfBirth = dateOfBirth;
        if (address !== undefined) student.address = address;
        if (parentName !== undefined || parentGuardianName !== undefined) student.parentName = parentGuardianName !== undefined ? parentGuardianName : parentName;
        if (parentPhone !== undefined || parentGuardianMobileNumber !== undefined) student.parentPhone = parentGuardianMobileNumber !== undefined ? parentGuardianMobileNumber : parentPhone;
        if (parentRelationship !== undefined) student.parentRelationship = String(parentRelationship).trim();
        if (gender !== undefined) student.gender = gender;
        if (academicYear !== undefined) student.academicYear = academicYear;
        if (umisId !== undefined) student.umisId = umisId;
        if (abcId !== undefined) student.abcId = abcId;
        if (dayScholarHosteller !== undefined) {
            if (!['Day Scholar', 'Hosteller', ''].includes(dayScholarHosteller)) return res.status(400).json({ success: false, message: 'Invalid Day Scholar / Hosteller value' });
            student.dayScholarHosteller = dayScholarHosteller;
        }
        if (status) student.status = status;
        await student.save();

        // Re-sequence class serials in case roll number, department, year or program changed
        await resequenceClassSerials(Student, student.department, student.year, student.program);

        res.status(200).json({
            success: true,
            message: 'Student updated successfully',
            student
        });
    } catch (error) {
        console.error('updateStudent error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update student',
            error: error.message
        });
    }
};

const updateParentSmsOptOut = async (req, res) => {
    try {
        if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid student id format' });
        }
        if (typeof req.body.parentSmsOptOut !== 'boolean') {
            return res.status(400).json({ success: false, message: 'Parent SMS opt-out must be true or false' });
        }

        const student = await Student.findById(req.params.id);
        if (!student) {
            return res.status(404).json({ success: false, message: 'Student not found' });
        }

        student.parentSmsOptOut = req.body.parentSmsOptOut;
        await student.save();

        return res.status(200).json({
            success: true,
            message: student.parentSmsOptOut
                ? 'Parent SMS opt-out saved. No further attendance SMS will be sent.'
                : 'Parent SMS opt-out removed.',
            studentId: student._id,
            parentSmsOptOut: student.parentSmsOptOut
        });
    } catch (error) {
        console.error('updateParentSmsOptOut error:', error);
        return res.status(500).json({ success: false, message: 'Failed to update parent SMS preference' });
    }
};

module.exports = {
    getStudents,
    getAllYearsStudents,
    getStudentById,
    addStudent,
    batchAddStudents,
    uploadExcel,
    deleteStudent,
    getStudentPhoto,
    uploadStudentPhoto,
    deleteStudentPhoto,
    updateStudent,
    updateParentSmsOptOut
};
