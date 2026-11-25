const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const http = require('http');

const Student = require('../models/Student');
const User = require('../models/User');
const Attendance = require('../models/Attendance');
const StudentRequest = require('../models/StudentRequest');

const baseUrl = 'http://localhost:5000';

async function request(method, endpoint, headers = {}, body = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(baseUrl + endpoint);
        const payload = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
        const options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
                ...headers
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                let parsed;
                try {
                    parsed = JSON.parse(data);
                } catch (e) {
                    parsed = data;
                }
                resolve({ status: res.statusCode, headers: res.headers, body: parsed });
            });
        });

        req.on('error', reject);

        if (payload) {
            req.write(payload);
        }
        req.end();
    });
}

async function runTests() {
    console.log('=== Starting UG & PG Integration Verification Suite ===\n');

    // Import server (which calls startServer on port 5000)
    require('../server');

    // Wait until MongoDB is ready and server is responding
    console.log('Waiting for backend and MongoDB Atlas to be ready...');
    let ready = false;
    for (let i = 0; i < 25; i++) {
        try {
            const health = await request('GET', '/api/health');
            if (health.status === 200 && (health.body.status === 'OK' || health.body.database === 'Connected')) {
                ready = true;
                break;
            }
        } catch (e) {}
        await new Promise(r => setTimeout(r, 1000));
    }

    if (!ready) {
        console.error('Backend failed to become ready in time.');
        process.exit(1);
    }
    console.log('Backend and MongoDB Atlas are online.\n');

    let passed = 0;
    let failed = 0;

    function assert(condition, testName, extraInfo = '') {
        if (condition) {
            console.log(`  [PASS] ${testName}`);
            passed++;
        } else {
            console.error(`  [FAIL] ${testName} ${extraInfo}`);
            failed++;
        }
    }

    try {
        // Test 1: Admin Login
        console.log('--- 1. Authentication Tests ---');
        const adminRes = await request('POST', '/api/auth/login', {}, { username: 'admin', password: 'admin123' });
        console.log('Admin login response:', JSON.stringify(adminRes));
        assert(adminRes.status === 200 && adminRes.body.token, 'Admin login (admin/admin123)');
        const adminToken = adminRes.body.token;

        // Test 2: UGCS Login
        const ugLoginRes = await request('POST', '/api/auth/login', {}, { username: 'UGCS', password: 'UGCS123' });
        assert(ugLoginRes.status === 200 && ugLoginRes.body.user.program === 'UG', 'UGCS login (UGCS/UGCS123) with program UG');
        const ugToken = ugLoginRes.body.token;

        // Test 3: PGCS Login
        const pgLoginRes = await request('POST', '/api/auth/login', {}, { username: 'PGCS', password: 'PGCS123' });
        assert(pgLoginRes.status === 200 && pgLoginRes.body.user.program === 'PG', 'PGCS login (PGCS/PGCS123) with program PG');
        const pgToken = pgLoginRes.body.token;

        // Test 4: UG Class Selection
        console.log('\n--- 2. Class Selection & Cross-Access Security Tests ---');
        const ugSelectCS1 = await request('POST', '/api/auth/select-class', { Authorization: `Bearer ${ugToken}` }, { classId: 'CS1' });
        assert(ugSelectCS1.status === 200 && ugSelectCS1.body.user.classId === 'CS1' && ugSelectCS1.body.user.year === '1', 'UGCS selecting CS1');
        const cs1Token = ugSelectCS1.body.token;

        const ugSelectCS2 = await request('POST', '/api/auth/select-class', { Authorization: `Bearer ${ugToken}` }, { classId: 'CS2' });
        assert(ugSelectCS2.status === 200 && ugSelectCS2.body.user.classId === 'CS2' && ugSelectCS2.body.user.year === '2', 'UGCS selecting CS2');

        const ugSelectCS3 = await request('POST', '/api/auth/select-class', { Authorization: `Bearer ${ugToken}` }, { classId: 'CS3' });
        assert(ugSelectCS3.status === 200 && ugSelectCS3.body.user.classId === 'CS3' && ugSelectCS3.body.user.year === '3', 'UGCS selecting CS3');

        // Test 5: UG account selecting PG class must fail
        const ugSelectPG = await request('POST', '/api/auth/select-class', { Authorization: `Bearer ${ugToken}` }, { classId: 'PGCS1' });
        assert(ugSelectPG.status === 403, 'UGCS selecting PGCS1 is blocked (403 Forbidden)');

        // Test 6: PG Class Selection
        const pgSelectPG1 = await request('POST', '/api/auth/select-class', { Authorization: `Bearer ${pgToken}` }, { classId: 'PGCS1' });
        assert(pgSelectPG1.status === 200 && pgSelectPG1.body.user.classId === 'PGCS1' && pgSelectPG1.body.user.year === '1', 'PGCS selecting PGCS1');
        const pgcs1Token = pgSelectPG1.body.token;

        const pgSelectPG2 = await request('POST', '/api/auth/select-class', { Authorization: `Bearer ${pgToken}` }, { classId: 'PGCS2' });
        assert(pgSelectPG2.status === 200 && pgSelectPG2.body.user.classId === 'PGCS2' && pgSelectPG2.body.user.year === '2', 'PGCS selecting PGCS2');

        // Test 7: PG account selecting UG class must fail
        const pgSelectUG = await request('POST', '/api/auth/select-class', { Authorization: `Bearer ${pgToken}` }, { classId: 'CS1' });
        assert(pgSelectUG.status === 403, 'PGCS selecting CS1 is blocked (403 Forbidden)');

        // Test 8: Student Scoping
        console.log('\n--- 3. Student Retrieval & Scoping Tests ---');
        // CS1 staff fetching students
        const cs1Students = await request('GET', '/api/students', { Authorization: `Bearer ${cs1Token}` });
        assert(cs1Students.status === 200 && cs1Students.body.students.length > 0, `CS1 staff gets ${cs1Students.body?.students?.length} students`);
        const allCS1AreUG = cs1Students.body?.students?.every(s => s.program === 'UG' && String(s.year) === '1');
        assert(allCS1AreUG, 'All students returned to CS1 staff have program=UG and year=1');

        // PGCS1 staff fetching students
        const pgcs1Students = await request('GET', '/api/students', { Authorization: `Bearer ${pgcs1Token}` });
        assert(pgcs1Students.status === 200 && pgcs1Students.body.students.length > 0, `PGCS1 staff gets ${pgcs1Students.body?.students?.length} students`);
        const allPG1ArePG = pgcs1Students.body?.students?.every(s => s.program === 'PG' && String(s.year) === '1');
        assert(allPG1ArePG, 'All students returned to PGCS1 staff have program=PG and year=1');

        // Admin fetching all PG students
        const adminPGStudents = await request('GET', '/api/students?department=Computer Science&program=PG', { Authorization: `Bearer ${adminToken}` });
        assert(adminPGStudents.status === 200 && adminPGStudents.body.students.length === 10, `Admin fetches all 10 PG students`);

        // Test 9: Attendance Marking & Scoping
        console.log('\n--- 4. Attendance Marking & Isolation Tests ---');
        const today = new Date().toISOString().split('T')[0];

        // CS1 marks attendance
        const cs1Mark = await request('POST', '/api/attendance/mark', { Authorization: `Bearer ${cs1Token}` }, {
            date: today,
            records: [
                { studentId: cs1Students.body.students[0].studentId, studentName: cs1Students.body.students[0].studentName, status: 'present' }
            ]
        });
        assert(cs1Mark.status === 200, `CS1 attendance recorded for ${cs1Students.body.students[0].studentId}`);

        // PGCS1 marks attendance
        const pgcs1Mark = await request('POST', '/api/attendance/mark', { Authorization: `Bearer ${pgcs1Token}` }, {
            date: today,
            records: [
                { studentId: pgcs1Students.body.students[0].studentId, studentName: pgcs1Students.body.students[0].studentName, status: 'present' }
            ]
        });
        assert(pgcs1Mark.status === 200, `PGCS1 attendance recorded for ${pgcs1Students.body.students[0].studentId}`);

        // Verify PG record in database has program=PG and classId=PGCS1
        const savedPGAtt = await Attendance.findOne({ studentId: pgcs1Students.body.students[0].studentId, date: today });
        assert(savedPGAtt && savedPGAtt.program === 'PG' && savedPGAtt.classId === 'PGCS1', 'PG Attendance record saved with program=PG and classId=PGCS1');

        // Test 10: Reports API (Daily Report)
        console.log('\n--- 5. Daily & Detailed Report Tests ---');
        // Staff daily report returns their own class
        const staffDaily = await request('GET', `/api/reports/daily?date=${today}`, { Authorization: `Bearer ${pgcs1Token}` });
        assert(staffDaily.status === 200 && staffDaily.body.reportData.length === 1 && staffDaily.body.reportData[0].classId === 'PGCS1', 'PGCS1 staff receives only PGCS1 in Daily Report');

        // Admin daily report with program=UG
        const adminDailyUG = await request('GET', `/api/reports/daily?date=${today}&program=UG`, { Authorization: `Bearer ${adminToken}` });
        assert(adminDailyUG.status === 200 && adminDailyUG.body.reportData.every(r => r.program === 'UG'), 'Admin daily report filtered by program=UG returns only UG classes (CS1, CS2, CS3)');

        // Admin daily report with program=PG
        const adminDailyPG = await request('GET', `/api/reports/daily?date=${today}&program=PG`, { Authorization: `Bearer ${adminToken}` });
        assert(adminDailyPG.status === 200 && adminDailyPG.body.reportData.every(r => r.program === 'PG'), 'Admin daily report filtered by program=PG returns only PG classes (PGCS1, PGCS2)');

        // Admin daily report with program=ALL
        const adminDailyAll = await request('GET', `/api/reports/daily?date=${today}&program=ALL`, { Authorization: `Bearer ${adminToken}` });
        assert(adminDailyAll.status === 200 && adminDailyAll.body.reportData.length === 5, 'Admin daily report with program=ALL returns all 5 classes');

        // Test 11: Student Registration Request for PG
        console.log('\n--- 6. PG Student Registration Request Flow Tests ---');
        const testRegNo = `25PCS999`;
        // Clean up if existed from previous run
        await StudentRequest.deleteMany({ studentRegisterNumber: testRegNo });
        await Student.deleteMany({ studentId: testRegNo });

        // PG staff submits request
        const submitReq = await request('POST', '/api/student-requests', { Authorization: `Bearer ${pgcs1Token}` }, {
            studentRegisterNumber: testRegNo,
            studentName: 'Test PG Student',
            department: 'Computer Science',
            academicYear: '1',
            year: '1'
        });
        assert(submitReq.status === 201 && submitReq.body.request.program === 'PG' && submitReq.body.request.classId === 'PGCS1', 'PGCS1 staff submits request with program=PG and classId=PGCS1');
        const createdReqId = submitReq.body.request._id;

        // Admin approves request
        const approveReq = await request('PATCH', `/api/student-requests/${createdReqId}/approve`, { Authorization: `Bearer ${adminToken}` }, {
            remarks: 'Approved by admin for PG'
        });
        assert(approveReq.status === 200 && approveReq.body.request.status === 'approved', 'Admin approves the PG registration request');

        // PG staff completes registration
        const completeReq = await request('POST', `/api/student-requests/${createdReqId}/complete-registration`, { Authorization: `Bearer ${pgcs1Token}` }, {
            studentRegisterNumber: testRegNo,
            studentName: 'Test PG Student'
        });
        assert(completeReq.status === 201 && completeReq.body.student.program === 'PG' && completeReq.body.student.classId === 'PGCS1', 'PGCS1 staff completes registration; student created in MongoDB Atlas with program=PG');

        // Clean up test student, request, and test attendance
        await Student.deleteMany({ studentId: testRegNo });
        await StudentRequest.deleteMany({ studentRegisterNumber: testRegNo });
        await Attendance.deleteMany({
            date: today,
            studentId: { $in: [cs1Students.body.students[0].studentId, pgcs1Students.body.students[0].studentId] }
        });

        console.log(`\n=== Verification Results: ${passed} passed, ${failed} failed ===\n`);

    } catch (err) {
        console.error('Unhandled test failure:', err);
        failed++;
    } finally {
        await mongoose.disconnect();
        process.exit(failed > 0 ? 1 : 0);
    }
}

runTests();
