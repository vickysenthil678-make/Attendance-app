const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env');
if (!fs.existsSync(envPath)) {
    console.error('backend/.env was not found. Configure it from .env.example.');
    process.exit(1);
}

const envLines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
const hasSetting = (name) => envLines.some((line) =>
    line.startsWith(`${name}=`) && line.slice(name.length + 1).trim()
);

console.log(`MONGODB_URI configured: ${Boolean(hasSetting('MONGODB_URI'))}`);
console.log(`JWT_SECRET configured: ${Boolean(hasSetting('JWT_SECRET'))}`);
console.log('This helper is read-only. Rotate database credentials in MongoDB Atlas and update backend/.env.');
