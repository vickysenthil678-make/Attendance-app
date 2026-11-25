const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const legacyIndex = {
    name: 'unique_attendance_legacy',
    key: { studentId: 1, date: 1, department: 1, year: 1, program: 1 },
    unique: true,
    partialFilterExpression: { period: { $type: 'null' } }
};
const periodIndex = {
    name: 'unique_attendance_period',
    key: { studentId: 1, date: 1, department: 1, year: 1, program: 1, period: 1 },
    unique: true,
    partialFilterExpression: { period: { $in: [1, 2, 3, 4, 5] } }
};

function sameIndex(index, expected) {
    return index.name === expected.name &&
        JSON.stringify(index.key) === JSON.stringify(expected.key) &&
        index.unique === expected.unique &&
        JSON.stringify(index.partialFilterExpression) === JSON.stringify(expected.partialFilterExpression);
}

async function prepareIndexes() {
    if (!process.env.MONGODB_URI) {
        throw new Error('MONGODB_URI is required.');
    }

    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
    const database = mongoose.connection.db;
    const exists = (await database.listCollections({ name: 'attendances' }, { nameOnly: true }).toArray()).length > 0;
    if (!exists) {
        throw new Error('The existing attendances collection was not found; no database or collection was created.');
    }

    const collection = database.collection('attendances');
    const invalidPeriodCount = await collection.countDocuments({
        period: { $exists: true, $ne: null, $nin: [1, 2, 3, 4, 5] }
    });
    if (invalidPeriodCount) {
        throw new Error(`Found ${invalidPeriodCount} attendance records with an unsupported period; review them before changing indexes.`);
    }

    const duplicates = await collection.aggregate([
        {
            $group: {
                _id: {
                    studentId: '$studentId',
                    date: '$date',
                    department: '$department',
                    year: '$year',
                    program: '$program',
                    period: { $ifNull: ['$period', null] }
                },
                count: { $sum: 1 }
            }
        },
        { $match: { count: { $gt: 1 } } },
        { $limit: 1 }
    ]).toArray();
    if (duplicates.length) {
        throw new Error('Duplicate attendance scopes exist; no indexes were changed.');
    }

    for (const expected of [legacyIndex, periodIndex]) {
        const indexes = await collection.listIndexes().toArray();
        const namedIndex = indexes.find(index => index.name === expected.name);
        if (namedIndex && !sameIndex(namedIndex, expected)) {
            throw new Error(`Index ${expected.name} exists with an unexpected definition; no indexes were changed.`);
        }
        if (!namedIndex) {
            const conflicting = indexes.find(index =>
                index.unique &&
                JSON.stringify(index.key) === JSON.stringify(expected.key) &&
                index.name !== '_id_'
            );
            if (conflicting) {
                throw new Error(`A conflicting unique index ${conflicting.name} exists; no indexes were changed.`);
            }
            await collection.createIndex(expected.key, {
                unique: expected.unique,
                partialFilterExpression: expected.partialFilterExpression,
                name: expected.name
            });
        }
    }

    const indexes = await collection.listIndexes().toArray();
    const broadUniqueIndexes = indexes.filter(index =>
        index.unique &&
        JSON.stringify(index.key) === JSON.stringify(legacyIndex.key) &&
        !index.partialFilterExpression
    );
    for (const index of broadUniqueIndexes) {
        await collection.dropIndex(index.name);
        console.log(`Removed obsolete uniqueness constraint ${index.name}; attendance records were not modified.`);
    }
    if (!broadUniqueIndexes.length) {
        console.log('Attendance uniqueness indexes are already period-aware; no index was removed.');
    }

    console.log('Attendance index migration completed without modifying attendance documents.');
}

prepareIndexes()
    .catch(error => {
        console.error('Attendance index migration failed:', error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect().catch(() => {});
    });
