
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const connectDB = require('./config/db');
const { validateSmsConfig } = require('./services/smsService');

// Existing route imports
const authRoutes = require('./routes/authRoutes');
const studentRoutes = require('./routes/studentRoutes');
const attendanceRoutes = require('./routes/attendanceRoutes');
const reportRoutes = require('./routes/reportRoutes');
const studentRequestRoutes = require('./routes/studentRequestRoutes');
const parentNotificationRoutes = require('./routes/parentNotificationRoutes');
const staffMessageRoutes = require('./routes/staffMessageRoutes');

const app = express();

function isLocalDevelopmentOrigin(origin) {
    try {
        const { protocol, hostname } = new URL(origin);
        const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
        if (protocol !== 'http:') return false;
        if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true;

        const octets = host.split('.').map(Number);
        if (octets.length !== 4 || octets.some(value => !Number.isInteger(value) || value < 0 || value > 255)) {
            return false;
        }

        return octets[0] === 127 ||
            octets[0] === 10 ||
            (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
            (octets[0] === 192 && octets[1] === 168);
    } catch {
        return false;
    }
}

// Security middleware
app.use(helmet());

// CORS configuration
const allowedOrigins = (process.env.FRONTEND_ORIGIN || 'http://localhost:5500')
    .split(',')
    .map(origin => origin.trim());
if (process.env.NODE_ENV !== 'production' && !allowedOrigins.includes('http://localhost:8081')) {
    allowedOrigins.push('http://localhost:8081');
}

app.use(
    cors({
        origin: (origin, callback) => {
            // Allow requests with no Origin header (curl, Postman, health checks).
            if (!origin) {
                return callback(null, true);
            }

            if (allowedOrigins.includes(origin)) {
                return callback(null, true);
            }

            if (process.env.NODE_ENV !== 'production') {
                if (origin === 'null' || isLocalDevelopmentOrigin(origin)) {
                    return callback(null, true);
                }
            }

            // In development, log the blocked origin to help diagnose mismatches.
            if (process.env.NODE_ENV !== 'production') {
                console.warn(`CORS blocked origin: "${origin}". Add it to FRONTEND_ORIGIN in .env`);
            }

            return callback(new Error('Origin not allowed by CORS'));
        },
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        credentials: true
    })
);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check
app.get('/api/health', (req, res) => {
    const mongoose = require('mongoose');

    const connected = mongoose.connection.readyState === 1;

    res.status(connected ? 200 : 503).json({
        status: connected ? 'OK' : 'DATABASE_DISCONNECTED',
        service: 'College Attendance Management API',
        database: connected ? 'Connected' : 'Disconnected',
        timestamp: new Date().toISOString()
    });
});

// Existing API routes
app.use('/api/auth', authRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/notifications', parentNotificationRoutes);
app.use('/api/messages', staffMessageRoutes);
app.use('/api/student-requests', studentRequestRoutes);
app.use('/api/student-registration-requests', studentRequestRoutes);

// 404 handler
app.use((req, res, next) => {
    res.status(404).json({
        success: false,
        message: `Endpoint ${req.originalUrl} not found`
    });
});

// Central error handler
app.use((err, req, res, next) => {
    console.error('Server error:', err.message);

    const statusCode = err.statusCode || 500;

    res.status(statusCode).json({
        success: false,
        message: err.message || 'Internal Server Error',
        stack: process.env.NODE_ENV === 'production'
            ? undefined
            : err.stack
    });
});

// Connect database first, then start server
const PORT = process.env.PORT || 5000;
const DB_RETRY_DELAY_MS = 5000;

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err.message);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

async function startServer() {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Attendance Backend running on port ${PORT}`);
        console.log(`API Base: http://localhost:${PORT}/api`);
        console.log(`Health Check: http://localhost:${PORT}/api/health`);
        console.log(`Allowed CORS Origins: ${allowedOrigins.join(', ')}`);
        console.log('');
        console.log(`Environment: ${process.env.NODE_ENV}`);
        validateSmsConfig();
    });

    try {
        await connectDB();
    } catch (error) {
        console.error('');
        console.error('===========================================');
        console.error('MongoDB connection failed');
        console.error('===========================================');
        console.error('');
        console.error('The API is running, but database-backed requests will be unavailable until MongoDB connects.');
        console.error('Check backend/.env MONGODB_URI and verify Atlas network access and credentials.');
        retryDatabaseConnection();
    }
}

function retryDatabaseConnection() {
    const retryTimer = setTimeout(async () => {
        try {
            await connectDB();
            console.log('MongoDB reconnected successfully.');
        } catch (error) {
            console.error(`MongoDB reconnection failed. Retrying in ${DB_RETRY_DELAY_MS / 1000} seconds.`);
            retryDatabaseConnection();
        }
    }, DB_RETRY_DELAY_MS);

    retryTimer.unref();
}

startServer();

module.exports = app;
