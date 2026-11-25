const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const bcrypt = require('bcryptjs');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const User = require('../models/User');
const Student = require('../models/Student');
const Attendance = require('../models/Attendance');
const StudentRequest = require('../models/StudentRequest');

async function migrate() {
    try {
        console.log('Connecting to MongoDB Atlas for migration...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB Atlas');

        // 1. Update Indexes on Student collection
        console.log('\n--- Checking Student Collection Indexes ---');
        try {
            const studentIndices = await Student.collection.indexes();
            for (const idx of studentIndices) {
                if (idx.name === 'studentId_1_department_1_year_1') {
                    console.log('Dropping old Student index studentId_1_department_1_year_1...');
                    await Student.collection.dropIndex('studentId_1_department_1_year_1');
                }
            }
        } catch (e) {
            console.log('Index drop notice:', e.message);
        }

        // 2. Migrate existing Students (Set program = 'UG', classId = 'CS' + year, academicYear)
        console.log('\n--- Migrating Existing Student Records ---');
        const studentsWithoutProgram = await Student.find({
            $or: [
                { program: { $exists: false } },
                { program: null },
                { program: '' },
                { classId: { $exists: false } },
                { classId: '' }
            ]
        });
        console.log(`Found ${studentsWithoutProgram.length} students requiring UG migration`);

        for (const s of studentsWithoutProgram) {
            const yr = String(s.year || '1');
            const sfx = yr === '1' ? '1st' : yr === '2' ? '2nd' : yr === '3' ? '3rd' : `${yr}th`;
            s.program = 'UG';
            s.academicYear = `${sfx} Year`;
            s.classId = `CS${yr}`;
            await s.save();
        }
        console.log('✅ All existing students updated to UG with proper classId and academicYear');

        // 3. Migrate existing Attendances
        console.log('\n--- Migrating Existing Attendance Records ---');
        try {
            const attIndices = await Attendance.collection.indexes();
            for (const idx of attIndices) {
                if (idx.name === 'studentId_1_date_1_department_1_year_1') {
                    console.log('Dropping old Attendance index studentId_1_date_1_department_1_year_1...');
                    await Attendance.collection.dropIndex('studentId_1_date_1_department_1_year_1');
                }
            }
        } catch (e) {
            console.log('Index drop notice:', e.message);
        }

        const attendancesWithoutProgram = await Attendance.find({
            $or: [
                { program: { $exists: false } },
                { program: null },
                { program: '' }
            ]
        });
        console.log(`Found ${attendancesWithoutProgram.length} attendance records requiring UG migration`);
        for (const a of attendancesWithoutProgram) {
            const yr = String(a.year || '1');
            const sfx = yr === '1' ? '1st' : yr === '2' ? '2nd' : yr === '3' ? '3rd' : `${yr}th`;
            a.program = 'UG';
            a.academicYear = `${sfx} Year`;
            a.classId = `CS${yr}`;
            await a.save();
        }
        console.log('✅ Existing attendance records migrated');

        // 4. Migrate existing Student Requests
        console.log('\n--- Migrating Student Requests ---');
        const requestsWithoutProgram = await StudentRequest.find({
            $or: [
                { program: { $exists: false } },
                { program: null },
                { program: '' }
            ]
        });
        console.log(`Found ${requestsWithoutProgram.length} requests requiring UG migration`);
        for (const r of requestsWithoutProgram) {
            r.program = 'UG';
            const yr = String(r.year || r.academicYear || '1');
            r.classId = `CS${yr}`;
            await r.save();
        }
        console.log('✅ Existing student requests migrated');

        // 5. Seed / Update Demo Users
        console.log('\n--- Setting up User Accounts ---');
        const usersToSetup = [
            {
                username: 'admin',
                name: 'System Administrator',
                password: 'admin123',
                role: 'admin',
                department: 'Administration',
                program: 'All',
                year: 'All',
                status: 'active'
            },
            {
                username: 'ugcs',
                name: 'UG CS Staff',
                password: 'UGCS123',
                role: 'staff',
                department: 'Computer Science',
                program: 'UG',
                year: 'All',
                status: 'active'
            },
            {
                username: 'pgcs',
                name: 'PG CS Staff',
                password: 'PGCS123',
                role: 'staff',
                department: 'Computer Science',
                program: 'PG',
                year: 'All',
                status: 'active'
            }
        ];

        for (const u of usersToSetup) {
            let existing = await User.findOne({ username: u.username.toLowerCase() }).select('+password');
            if (existing) {
                existing.name = u.name;
                existing.role = u.role;
                existing.department = u.department;
                existing.program = u.program;
                existing.year = u.year;
                existing.classId = u.classId || '';
                existing.status = u.status;
                // Update password (pre-save hook hashes plain text)
                existing.password = u.password;
                await existing.save();
                console.log(`Updated user: ${u.username} (${u.program} - ${u.year})`);
            } else {
                await User.create(u);
                console.log(`Created user: ${u.username} (${u.program} - ${u.year})`);
            }
        }

        // 6. Seed Sample PG Students into MongoDB Atlas
        console.log('\n--- Seeding PG Students into MongoDB Atlas ---');
        const pgSampleStudents = [
            // PG 1st Year (PGCS1)
            { serial: 1, studentId: '25PCS001', studentName: 'Arunkumar M', department: 'Computer Science', program: 'PG', year: '1', academicYear: '1st Year', classId: 'PGCS1', status: 'active', gender: 'Male', phone: '9876543210' },
            { serial: 2, studentId: '25PCS002', studentName: 'Deepa K', department: 'Computer Science', program: 'PG', year: '1', academicYear: '1st Year', classId: 'PGCS1', status: 'active', gender: 'Female', phone: '9876543211' },
            { serial: 3, studentId: '25PCS003', studentName: 'Elango R', department: 'Computer Science', program: 'PG', year: '1', academicYear: '1st Year', classId: 'PGCS1', status: 'active', gender: 'Male', phone: '9876543212' },
            { serial: 4, studentId: '25PCS004', studentName: 'Gowtham S', department: 'Computer Science', program: 'PG', year: '1', academicYear: '1st Year', classId: 'PGCS1', status: 'active', gender: 'Male', phone: '9876543213' },
            { serial: 5, studentId: '25PCS005', studentName: 'Hemalatha V', department: 'Computer Science', program: 'PG', year: '1', academicYear: '1st Year', classId: 'PGCS1', status: 'active', gender: 'Female', phone: '9876543214' },

            // PG 2nd Year (PGCS2)
            { serial: 1, studentId: '24PCS001', studentName: 'Jayanthi P', department: 'Computer Science', program: 'PG', year: '2', academicYear: '2nd Year', classId: 'PGCS2', status: 'active', gender: 'Female', phone: '9876543220' },
            { serial: 2, studentId: '24PCS002', studentName: 'Manikandan T', department: 'Computer Science', program: 'PG', year: '2', academicYear: '2nd Year', classId: 'PGCS2', status: 'active', gender: 'Male', phone: '9876543221' },
            { serial: 3, studentId: '24PCS003', studentName: 'Nandhini B', department: 'Computer Science', program: 'PG', year: '2', academicYear: '2nd Year', classId: 'PGCS2', status: 'active', gender: 'Female', phone: '9876543222' },
            { serial: 4, studentId: '24PCS004', studentName: 'Praveen Kumar N', department: 'Computer Science', program: 'PG', year: '2', academicYear: '2nd Year', classId: 'PGCS2', status: 'active', gender: 'Male', phone: '9876543223' },
            { serial: 5, studentId: '24PCS005', studentName: 'Rajeshwari G', department: 'Computer Science', program: 'PG', year: '2', academicYear: '2nd Year', classId: 'PGCS2', status: 'active', gender: 'Female', phone: '9876543224' }
        ];

        for (const s of pgSampleStudents) {
            const exists = await Student.findOne({
                studentId: s.studentId,
                department: s.department,
                year: s.year,
                program: s.program
            });
            if (!exists) {
                await Student.create(s);
                console.log(`Seeded PG Student: ${s.studentId} - ${s.studentName} (${s.classId})`);
            } else {
                exists.academicYear = s.academicYear;
                exists.classId = s.classId;
                await exists.save();
                console.log(`PG Student already exists: ${s.studentId} - updated metadata`);
            }
        }

        console.log('\n===========================================');
        console.log('✅ MIGRATION AND SEEDING COMPLETED SUCCESSFULLY');
        console.log('===========================================');
        console.log('UG Credentials: UGCS / UGCS123 -> Displays CS1, CS2, CS3');
        console.log('PG Credentials: PGCS / PGCS123 -> Displays PGCS1, PGCS2');
        console.log('Admin Credentials: admin / admin123 -> Full access to UG and PG');
        console.log('===========================================\n');

        await mongoose.connection.close();
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

migrate();
