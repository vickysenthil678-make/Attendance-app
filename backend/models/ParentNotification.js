const mongoose = require('mongoose');

const statusHistorySchema = new mongoose.Schema(
    {
        status: {
            type: String,
            enum: ['pending', 'sent', 'delivered', 'failed', 'skipped'],
            required: true
        },
        action: { type: String, trim: true, default: '' },
        reason: { type: String, trim: true, default: '' },
        at: { type: Date, default: Date.now }
    },
    { _id: false }
);

const parentNotificationSchema = new mongoose.Schema(
    {
        eventKey: {
            type: String,
            required: true,
            unique: true
        },
        eventType: {
            type: String,
            enum: ['absence', 'correction'],
            required: true
        },
        attendanceRecordId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Attendance',
            default: undefined
        },
        studentId: { type: String, required: true, trim: true, uppercase: true },
        studentName: { type: String, trim: true, default: '' },
        parentName: { type: String, trim: true, default: '' },
        parentPhone: { type: String, trim: true, default: '' },
        department: { type: String, required: true, trim: true },
        program: { type: String, enum: ['UG', 'PG'], required: true },
        year: { type: String, required: true, trim: true },
        classId: { type: String, required: true, trim: true, uppercase: true },
        attendanceDate: {
            type: String,
            required: true,
            match: [/^\d{4}-\d{2}-\d{2}$/, 'Attendance date must be YYYY-MM-DD']
        },
        status: {
            type: String,
            enum: ['pending', 'sent', 'delivered', 'failed', 'skipped'],
            required: true,
            default: 'pending'
        },
        failureReason: { type: String, default: '' },
        statusHistory: { type: [statusHistorySchema], default: [] },
        providerMessageId: { type: String, default: '', index: true },
        attempts: { type: Number, default: 0, min: 0 },
        sentAt: { type: Date, default: null }
    },
    { timestamps: true }
);

parentNotificationSchema.index({ department: 1, program: 1, attendanceDate: -1, status: 1 });
parentNotificationSchema.index(
    { studentId: 1, attendanceRecordId: 1, eventType: 1 },
    {
        unique: true,
        partialFilterExpression: { attendanceRecordId: { $type: 'objectId' } }
    }
);

module.exports = mongoose.model('ParentNotification', parentNotificationSchema);
