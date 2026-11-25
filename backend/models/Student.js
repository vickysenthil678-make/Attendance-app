const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema(
    {
        studentName: {
            type: String,
            required: [true, 'Student name is required'],
            trim: true
        },
        studentId: {
            type: String,
            required: [true, 'Student register number/ID is required'],
            trim: true,
            uppercase: true
        },
        serial: {
            type: Number,
            default: 1
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
        status: {
            type: String,
            enum: ['active', 'inactive'],
            default: 'active'
        },
        /** GridFS file reference for the student's photo */
        photoId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "fs.files",
            default: null
        },
        photoMimeType: {
            type: String,
            enum: ['image/jpeg', 'image/png', ''],
            default: ''
        },
        photo: {
            type: String,
            default: ''
        },
        email: {
            type: String,
            trim: true,
            lowercase: true
        },
        phone: {
            type: String,
            trim: true
        },
        umisId: { type: String, trim: true, default: '' },
        abcId: { type: String, trim: true, default: '' },
        dayScholarHosteller: { type: String, enum: ['Day Scholar', 'Hosteller', ''], default: '' },
        dateOfBirth: {
            type: Date
        },
        address: {
            type: String,
            trim: true
        },
        parentName: {
            type: String,
            trim: true
        },
        parentPhone: {
            type: String,
            trim: true
        },
        parentRelationship: {
            type: String,
            trim: true,
            default: ''
        },
        parentSmsOptOut: {
            type: Boolean,
            default: false
        },
        gender: {
            type: String,
            trim: true,
            enum: ['Male', 'Female', 'Other', '']
        }
    },
    {
        timestamps: true
    }
);

studentSchema.pre('save', function (next) {
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

// Prevent duplicate studentId in the same program, department and year
studentSchema.index({ studentId: 1, department: 1, year: 1, program: 1 }, { unique: true });
// Optimize class queries sorted by roll number
studentSchema.index({ program: 1, department: 1, year: 1, studentId: 1 });
studentSchema.index({ classId: 1, studentId: 1 });

module.exports = mongoose.model('Student', studentSchema);
