const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function backup() {
    try {
        console.log('Connecting to MongoDB Atlas for backup...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB Atlas');

        const backupDir = path.join(__dirname, '..', 'backups', `backup-${Date.now()}`);
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }

        const collections = await mongoose.connection.db.listCollections().toArray();
        for (const col of collections) {
            if (col.name.startsWith('fs.')) continue; // skip gridfs chunks for json dump
            const docs = await mongoose.connection.db.collection(col.name).find({}).toArray();
            const filePath = path.join(backupDir, `${col.name}.json`);
            fs.writeFileSync(filePath, JSON.stringify(docs, null, 2));
            console.log(`Backed up ${col.name} (${docs.length} documents) to ${filePath}`);
        }

        console.log('\nBackup completed successfully in:', backupDir);
        await mongoose.connection.close();
        process.exit(0);
    } catch (error) {
        console.error('Backup failed:', error);
        process.exit(1);
    }
}

backup();
