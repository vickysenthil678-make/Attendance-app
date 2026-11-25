const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env') });
const User = require('../models/User');

async function removeOldStaff() {
    try {
        console.log('Connecting to MongoDB Atlas...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to DB');

        const oldUsernames = ['cs', 'cs1', 'cs2', 'cs3'];
        const result = await User.deleteMany({ username: { $in: oldUsernames } });
        console.log(`Deleted ${result.deletedCount} old user accounts: ${oldUsernames.join(', ')}`);

        const remainingUsers = await User.find({}, 'username role program classId academicYear');
        console.log('\nRemaining Active Users:');
        remainingUsers.forEach(u => {
            console.log(`- Username: ${u.username}, Role: ${u.role}, Program: ${u.program}, ClassId: ${u.classId || '(None - Selected post-login)'}`);
        });

        await mongoose.disconnect();
        console.log('\nDone.');
    } catch (err) {
        console.error('Error removing old staff:', err);
        process.exit(1);
    }
}

removeOldStaff();
