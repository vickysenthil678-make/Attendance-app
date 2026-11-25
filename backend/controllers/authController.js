const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { PROGRAMME_ACCOUNTS } = require('../config/programmeAccounts');

function normalizeStaffProgram(value) {
    const program = String(value || 'UG').trim().toUpperCase();
    if (program === 'ALL') return 'All';
    return ['UG', 'PG'].includes(program) ? program : null;
}

// Class IDs supported for the common Computer Science staff login (UG & PG)
const CLASS_CONFIG = {
    CS1: { year: '1', program: 'UG', name: 'UG 1st Year' },
    CS2: { year: '2', program: 'UG', name: 'UG 2nd Year' },
    CS3: { year: '3', program: 'UG', name: 'UG 3rd Year' },
    PGCS1: { year: '1', program: 'PG', name: 'PG 1st Year' },
    PGCS2: { year: '2', program: 'PG', name: 'PG 2nd Year' }
};

const CLASS_YEAR_MAP = {
    CS1: '1',
    CS2: '2',
    CS3: '3',
    PGCS1: '1',
    PGCS2: '2'
};

// Generate JWT token
const generateToken = (user, scope = {}) => {
    if (!process.env.JWT_SECRET) {
        throw new Error('JWT_SECRET is missing from .env file');
    }

    const payload = {
        id: user._id || user.id,
        role: user.role,
        program: scope.program || user.program || 'UG',
        department: user.department || 'Computer Science'
    };

    if (scope.year) payload.year = String(scope.year);
    if (scope.classId) payload.classId = scope.classId;
    if (scope.program) payload.program = scope.program;

    return jwt.sign(
        payload,
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
};

// Login
const login = async (req, res) => {
    try {
        const { username, email, password } = req.body;

        const rawLoginId = (username || email || '').trim();

        if (!rawLoginId || !password) {
            return res.status(400).json({
                success: false,
                message: 'Username/email and password are required'
            });
        }

        const loginId = rawLoginId.toLowerCase();

        const user = await User.findOne({
            $or: [
                { username: loginId },
                { email: loginId }
            ]
        }).select('+password');

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Invalid username or password'
            });
        }

        const assignedScope = PROGRAMME_ACCOUNTS[loginId];
        if (assignedScope && user.role !== 'staff') {
            return res.status(401).json({
                success: false,
                message: 'Invalid username or password'
            });
        }

        if (user.status === 'inactive') {
            return res.status(403).json({
                success: false,
                message: 'Account has been deactivated'
            });
        }

        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: 'Invalid username or password'
            });
        }

        const token = generateToken(user, assignedScope || {});
        const userProgram = assignedScope?.program || user.program || 'UG';
        const userYear = assignedScope?.year || user.year || '';
        const userClassId = assignedScope?.classId || user.classId || '';
        const userDepartment = assignedScope?.department || user.department || '';

        return res.status(200).json({
            success: true,
            message: 'Login successful',
            token,
            user: {
                id: user._id,
                username: user.username,
                name: user.name || user.username,
                email: user.email,
                role: user.role,
                department: userDepartment,
                program: userProgram,
                year: userYear,
                classId: userClassId,
                status: user.status
            }
        });
    } catch (error) {
        console.error('Login error:', error.message);

        return res.status(500).json({
            success: false,
            message: 'Login failed due to a server error'
        });
    }
};

// Get current logged-in user
const getMe = async (req, res) => {
    try {
        const userId = req.user.id || req.user._id;

        const user = await User.findById(userId).select('-password');

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const userObj = user.toObject();
        // Reflect the class selected through a scoped token (common staff account)
        userObj.program = req.user.program || user.program || 'UG';
        if (req.user.year && req.user.year !== 'All') {
            userObj.year = req.user.year;
        }
        if (req.user.classId) {
            userObj.classId = req.user.classId;
        }

        return res.json({
            success: true,
            user: userObj
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: 'Unable to get user details'
        });
    }
};

// Logout
const logout = async (req, res) => {
    return res.status(200).json({
        success: true,
        message: 'Logout successful. Remove the token from the client.'
    });
};

// Create staff account (admin only)
const createStaff = async (req, res) => {
    try {
        const { username, email, password, role, department, program, year } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: 'Username and password are required'
            });
        }

        if (role && role.toLowerCase() !== 'staff') {
            return res.status(400).json({
                success: false,
                message: 'Only staff accounts can be created here'
            });
        }

        const staffProgram = normalizeStaffProgram(program);
        if (!staffProgram) {
            return res.status(400).json({
                success: false,
                message: 'Programme must be UG, PG, or All'
            });
        }

        const existingUser = await User.findOne({
            $or: [
                { username },
                ...(email ? [{ email }] : [])
            ]
        });

        if (existingUser) {
            return res.status(409).json({
                success: false,
                message: 'Username or email already exists'
            });
        }

        const hashedPassword = await bcrypt.hash(password, 12);

        const staff = await User.create({
            username,
            ...(email ? { email } : {}),
            password: hashedPassword,
            role: 'staff',
            ...(department ? { department } : {}),
            program: staffProgram,
            ...(year ? { year } : {})
        });

        return res.status(201).json({
            success: true,
            message: 'Staff account created successfully',
            staff: {
                id: staff._id,
                username: staff.username,
                email: staff.email,
                role: staff.role,
                department: staff.department,
                program: staff.program,
                year: staff.year
            }
        });
    } catch (error) {
        console.error('Create staff error:', error.message);

        return res.status(500).json({
            success: false,
            message: 'Unable to create staff account'
        });
    }
};

// List staff accounts
const listStaff = async (req, res) => {
    try {
        const staff = await User.find({ role: 'staff' })
            .select('-password')
            .sort({ username: 1 });

        return res.json({
            success: true,
            count: staff.length,
            staff
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: 'Unable to retrieve staff accounts'
        });
    }
};

// Update staff account
const updateStaff = async (req, res) => {
    try {
        const { username, email, password, department, program, year } = req.body;

        const staff = await User.findOne({
            _id: req.params.id,
            role: 'staff'
        });

        if (!staff) {
            return res.status(404).json({
                success: false,
                message: 'Staff account not found'
            });
        }

        const staffProgram = program === undefined ? undefined : normalizeStaffProgram(program);
        if (program !== undefined && !staffProgram) {
            return res.status(400).json({
                success: false,
                message: 'Programme must be UG, PG, or All'
            });
        }

        if (username !== undefined) staff.username = username;
        if (email !== undefined) staff.email = email;
        if (department !== undefined) staff.department = department;
        if (staffProgram !== undefined) staff.program = staffProgram;
        if (year !== undefined) staff.year = year;

        if (password) {
            staff.password = await bcrypt.hash(password, 12);
        }

        await staff.save();

        return res.json({
            success: true,
            message: 'Staff account updated successfully',
            staff: {
                id: staff._id,
                username: staff.username,
                email: staff.email,
                role: staff.role,
                department: staff.department,
                program: staff.program,
                year: staff.year
            }
        });
    } catch (error) {
        console.error('Update staff error:', error.message);

        return res.status(500).json({
            success: false,
            message: 'Unable to update staff account'
        });
    }
};

// Select a class after logging in with the common Computer Science staff account (UG or PG)
const selectClass = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'staff') {
            return res.status(403).json({
                success: false,
                message: 'Only staff accounts can select a class'
            });
        }

        const classId = String(req.body.classId || '').trim().toUpperCase();
        const classConfig = CLASS_CONFIG[classId];

        if (!classConfig) {
            return res.status(400).json({
                success: false,
                message: 'Invalid class. Choose CS1, CS2, CS3, PGCS1 or PGCS2'
            });
        }

        const department = String(req.user.department || '').trim();
        if (!/^computer\s+science$/i.test(department)) {
            return res.status(403).json({
                success: false,
                message: 'Class selection is only available for Computer Science staff'
            });
        }

        // Program authorization check: UG staff cannot pick PG classes, and vice versa
        const userProgram = req.user.program || 'UG';
        if (userProgram !== 'All' && userProgram !== classConfig.program) {
            return res.status(403).json({
                success: false,
                message: `Access denied: This account is authorized for ${userProgram} classes only (${userProgram === 'PG' ? 'PGCS1, PGCS2' : 'CS1, CS2, CS3'})`
            });
        }

        const targetYear = classConfig.year;
        const targetProgram = classConfig.program;

        const assignedYear = String(req.user.year || 'All');
        if (assignedYear !== 'All' && assignedYear !== targetYear) {
            return res.status(403).json({
                success: false,
                message: `Access denied: This account is assigned to Year ${assignedYear}`
            });
        }

        const token = generateToken(req.user, { year: targetYear, classId, program: targetProgram });

        return res.status(200).json({
            success: true,
            message: `${classId} (${classConfig.name}) selected`,
            token,
            user: {
                id: req.user._id || req.user.id,
                username: req.user.username,
                name: req.user.name || req.user.username,
                email: req.user.email || '',
                role: 'staff',
                department,
                program: targetProgram,
                year: targetYear,
                classId,
                status: req.user.status || 'active'
            }
        });
    } catch (error) {
        console.error('Select class error:', error.message);

        return res.status(500).json({
            success: false,
            message: 'Unable to select class'
        });
    }
};

module.exports = {
    login,
    getMe,
    logout,
    createStaff,
    listStaff,
    updateStaff,
    selectClass
};
