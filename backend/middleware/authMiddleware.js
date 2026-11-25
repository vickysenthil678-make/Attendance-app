const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { PROGRAMME_ACCOUNTS } = require('../config/programmeAccounts');

const protect = async (req, res, next) => {
    let token;

    if (
        req.headers.authorization &&
        req.headers.authorization.startsWith('Bearer ')
    ) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'Not authorized, no token provided'
        });
    }

    // Check for local token first (for offline/local development)
    if (token.startsWith('local-token-')) {
        const username = token.replace('local-token-', '');
        
        // Create a mock user object for local authentication
        if (username === 'admin') {
            req.user = {
                _id: 'local-admin',
                username: 'admin',
                name: 'System Administrator',
                role: 'admin',
                department: 'Administration',
                program: 'All',
                year: 'All',
                status: 'active'
            };
            return next();
        }
        
        return res.status(401).json({
            success: false,
            message: 'Not authorized, unknown local user'
        });
    }

    // JWT Token verification (for users with actual JWT tokens)
    try {
        const secret = process.env.JWT_SECRET;

        if (!secret) {
            return res.status(500).json({
                success: false,
                message: 'Server configuration error'
            });
        }

        const decoded = jwt.verify(token, secret);

        const user = await User.findById(decoded.id).select('-password');

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'User no longer exists'
            });
        }

        if (user.status === 'inactive') {
            return res.status(403).json({
                success: false,
                message: 'Account has been deactivated'
            });
        }

        const fixedScope = PROGRAMME_ACCOUNTS[String(user.username || '').toLowerCase()];
        if (fixedScope) {
            if (user.role !== 'staff' ||
                (decoded.year && String(decoded.year) !== fixedScope.year) ||
                (decoded.program && decoded.program !== fixedScope.program) ||
                (decoded.classId && decoded.classId !== fixedScope.classId)) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied: this account is assigned to a different class'
                });
            }

            req.user = { ...user.toObject(), ...fixedScope };
            return next();
        }

        // A class-selection token carries the chosen class. It is signed by the
        // server, so this year and program override the account's default scope.
        if (decoded.year) {
            const tokenProgram = decoded.program || user.program || 'UG';
            const validYears = tokenProgram === 'PG' ? ['1', '2'] : ['1', '2', '3'];

            if (user.role !== 'staff' || !validYears.includes(String(decoded.year))) {
                return res.status(401).json({
                    success: false,
                    message: 'Not authorized, invalid class scope in token'
                });
            }

            const assignedYear = String(user.year || 'All');
            const assignedProgram = user.program || 'UG';
            const expectedClassId = assignedProgram === 'PG' ? `PGCS${decoded.year}` : `CS${decoded.year}`;
            if ((assignedYear !== 'All' && assignedYear !== String(decoded.year)) ||
                (assignedProgram !== 'All' && assignedProgram !== tokenProgram) ||
                (user.classId && user.classId !== expectedClassId)) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied: this account is assigned to a different class'
                });
            }

            const scopedUser = user.toObject();
            scopedUser.baseYear = String(user.year || 'All');
            scopedUser.year = String(decoded.year);
            scopedUser.program = tokenProgram;
            scopedUser.classId = decoded.classId || (tokenProgram === 'PG' ? `PGCS${decoded.year}` : `CS${decoded.year}`);
            req.user = scopedUser;
            return next();
        }

        const userObj = user.toObject();
        userObj.program = decoded.program || user.program || 'UG';
        req.user = userObj;
        next();
    } catch (error) {
        console.error('JWT Verification Error:', error.message);
        return res.status(401).json({
            success: false,
            message: 'Not authorized, token invalid or expired'
        });
    }
};

module.exports = { protect };
