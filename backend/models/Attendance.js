const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema(
    {
        student: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Student',
            required: false
        },
        studentId: {
            type: String,
            required: [true, 'Student register number is required'],
            trim: true,
            uppercase: true
        },
        studentName: {
            type: String,
            trim: true,
            default: ''
        },
        date: {
            type: String, // Format: YYYY-MM-DD
            required: [true, 'Attendance date is required'],
            match: [/^\d{4}-\d{2}-\d{2}$/, 'Date must be formatted as YYYY-MM-DD']
        },
        department: {
            type: String,
            required: [true, 'Department is required'],
            trim: true
        },
        program: {
            type: String,
            enum: ['UG', 'PG'],
            default: 'UG',
            trim: true,
            uppercase: true
        },
        year: {
            type: String,
            required: [true, 'Year is required'],
            trim: true
        },
        academicYear: {
            type: String,
            trim: true,
            default: ''
        },
        classId: {
            type: String,
            trim: true,
            uppercase: true,
            default: ''
        },
        period: {
            type: Number,
            enum: [null, 1, 2, 3, 4, 5],
            default: null
        },
        status: {
            type: String,
            enum: ['present', 'absent'],
            required: [true, 'Status must be present or absent']
        },
        recordedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        }
    },
    {
        timestamps: true
    }
);

attendanceSchema.pre('save', function (next) {
    if (!this.program) {
        this.program = (this.classId && this.classId.startsWith('PG')) ? 'PG' : 'UG';
    }
    if (!this.classId && this.year) {
        this.classId = (this.program === 'PG') ? `PGCS${this.year}` : `CS${this.year}`;
    }
    if (!this.academicYear && this.year) {
        const sfx = this.year === '1' ? '1st' : this.year === '2' ? '2nd' : this.year === '3' ? '3rd' : `${this.year}th`;
        this.academicYear = `${sfx} Year`;
    }
    next();
});

attendanceSchema.index(
    { studentId: 1, date: 1, department: 1, year: 1, program: 1 },
    {
        unique: true,
        partialFilterExpression: { period: { $type: 'null' } },
        name: 'unique_attendance_legacy'
    }
);

attendanceSchema.index(
    { studentId: 1, date: 1, department: 1, year: 1, program: 1, period: 1 },
    {
        unique: true,
        partialFilterExpression: { period: { $in: [1, 2, 3, 4, 5] } },
        name: 'unique_attendance_period'
    }
);

// Index for high-performance date-range report queries
attendanceSchema.index({ program: 1, department: 1, year: 1, date: 1 });
attendanceSchema.index({ classId: 1, date: 1 });
attendanceSchema.index({ classId: 1, date: 1, period: 1 });

module.exports = mongoose.model('Attendance', attendanceSchema);
