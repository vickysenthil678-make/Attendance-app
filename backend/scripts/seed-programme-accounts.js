// Create/update the dedicated UG and PG staff accounts without touching student data.
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const path = require('path');
const User = require('../models/User');
const { PROGRAMME_ACCOUNTS } = require('../config/programmeAccounts');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const credentials = {
    ugcs1: 'UGCS123',
    ugcs2: 'UGCS123',
    ugcs3: 'UGCS123',
    pgcs1: 'PGCS123',
    pgcs2: 'PGCS123'
};

async function seedProgrammeAccounts() {
    if (!process.env.MONGODB_URI) {
        throw new Error('MONGODB_URI is missing from backend/.env');
    }

    await mongoose.connect(process.env.MONGODB_URI);
    for (const [username, scope] of Object.entries(PROGRAMME_ACCOUNTS)) {
        let user = await User.findOne({ username });
        if (!user) user = new User({ username });

        user.name = `${scope.program} Computer Science - Year ${scope.year}`;
        user.password = credentials[username];
        user.role = 'staff';
        user.department = scope.department;
        user.program = scope.program;
        user.year = scope.year;
        user.classId = scope.classId;
        user.status = 'active';
        await user.save();
        console.log(`Configured ${username.toUpperCase()} for ${scope.program} Year ${scope.year} (${scope.classId})`);
    }
}

seedProgrammeAccounts()
    .then(() => mongoose.disconnect())
    .catch(async error => {
        console.error('Could not configure UG/PG accounts:', error.message);
        await mongoose.disconnect().catch(() => {});
        process.exitCode = 1;
    });
