const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env') });
const User = require('../models/User');

const usersToReset = [
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
        classId: '',
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
        classId: '',
        status: 'active'
    }
];

async function resetUsers() {
    try {
        console.log('Connecting to MongoDB Atlas...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected.');

        for (const u of usersToReset) {
            let user = await User.findOne({ username: u.username.toLowerCase() }).select('+password');
            if (user) {
                user.name = u.name;
                user.role = u.role;
                user.department = u.department;
                user.program = u.program;
                user.year = u.year;
                user.classId = u.classId || '';
                user.status = u.status;
                user.password = u.password; // pre('save') hook will hash it cleanly once
                await user.save();
                console.log(`Updated user: ${u.username} with new password`);
            } else {
                await User.create(u); // pre('save') hook will hash it cleanly once
                console.log(`Created user: ${u.username}`);
            }
        }

        console.log('\nTesting passwords...');
        for (const u of usersToReset) {
            const user = await User.findOne({ username: u.username.toLowerCase() }).select('+password');
            const match = await user.matchPassword(u.password);
            console.log(`User ${u.username} password match (${u.password}): ${match ? '✅ MATCH' : '❌ FAILED'}`);
        }

        await mongoose.disconnect();
        console.log('Done.');
    } catch (err) {
        console.error('Reset error:', err);
        process.exit(1);
    }
}

resetUsers();
