const mongoose = require('mongoose');

const periodRecordSchema = new mongoose.Schema(
    {
        studentId: {
            type: String,
            required: true,
            trim: true,
            uppercase: true
        },
        studentName: {
            type: String,
            trim: true,
            default: ''
        },
        status: {
            type: String,
            enum: ['present', 'absent'],
            required: true
        }
    },
    { _id: false }
);

const periodAttendanceSchema = new mongoose.Schema(
    {
        date: {
            type: String,
            required: true,
            match: [/^\d{4}-\d{2}-\d{2}$/, 'Date must be formatted as YYYY-MM-DD']
        },
        department: { type: String, required: true, trim: true },
        program: { type: String, required: true, enum: ['UG', 'PG'], uppercase: true },
        year: { type: String, required: true, trim: true },
        classId: { type: String, required: true, trim: true, uppercase: true },
        period: { type: Number, required: true, min: 1, max: 5 },
        records: { type: [periodRecordSchema], required: true },
        locked: { type: Boolean, default: true },
        lockedAt: { type: Date, default: Date.now },
        recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        unlockedAt: { type: Date, default: null },
        unlockedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
    },
    { timestamps: true }
);

periodAttendanceSchema.index(
    { date: 1, department: 1, program: 1, year: 1, classId: 1, period: 1 },
    { unique: true }
);
periodAttendanceSchema.index({ department: 1, program: 1, year: 1, date: 1 });

module.exports = mongoose.model('PeriodAttendance', periodAttendanceSchema);
