const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            trim: true,
            default: ''
        },
        username: {
            type: String,
            required: [true, 'Username is required'],
            unique: true,
            trim: true,
            lowercase: true
        },
        password: {
            type: String,
            required: [true, 'Password is required'],
            select: false // Do not include password in queries by default
        },
        role: {
            type: String,
            enum: ['admin', 'staff'],
            default: 'staff'
        },
        department: {
            type: String,
            required: [true, 'Department is required'],
            trim: true,
            default: 'General'
        },
        program: {
            type: String,
            enum: ['UG', 'PG', 'All'],
            default: 'UG',
            trim: true
        },
        year: {
            type: String,
            trim: true,
            default: 'All' // '1', '2', '3', or 'All'
        },
        classId: {
            type: String,
            trim: true,
            default: ''
        },
        status: {
            type: String,
            enum: ['active', 'inactive'],
            default: 'active'
        },
        email: {
            type: String,
            trim: true,
            lowercase: true,
            default: ''
        }
    },
    {
        timestamps: true
    }
);

// Hash password before saving if modified
userSchema.pre('save', async function (next) {
    if (!this.isModified('password')) {
        return next();
    }
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
});

// Compare entered password with hashed password
userSchema.methods.matchPassword = async function (enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
