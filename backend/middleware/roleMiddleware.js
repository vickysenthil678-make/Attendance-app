/**
 * Restrict endpoint access to specific roles (e.g. 'admin')
 */
const requireRole = (...roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }

        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: `Forbidden: Access restricted to ${roles.join(' or ')}`
            });
        }

        next();
    };
};

/**
 * Enforce staff academic scope restrictions:
 * Staff can ONLY access their assigned department and year.
 * Admins are unrestricted across all departments and years.
 */
const enforceClassScope = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    if (req.user.role === 'admin') {
        return next(); // Admins have unrestricted access
    }

    // Staff using the common account must choose a class first
    if (!req.user.year || req.user.year === 'All') {
        const classChoices = req.user.program === 'PG' ? 'PGCS1 or PGCS2' : 'CS1, CS2 or CS3';
        return res.status(403).json({
            success: false,
            message: `Please select a class (${classChoices}) before accessing class data`
        });
    }

    // For staff, extract requested department, year, program and classId
    const body = req.body || {};
    const reqDept = body.department || req.query.department;
    const reqYear = body.year !== undefined ? String(body.year) : (req.query.year !== undefined ? String(req.query.year) : null);
    const reqProgram = body.program || req.query.program;
    const reqClassId = body.classId || req.query.classId;

    if (reqDept && reqDept.trim().toLowerCase() !== req.user.department.trim().toLowerCase()) {
        return res.status(403).json({
            success: false,
            message: `Access denied: You are only authorized for ${req.user.department}`
        });
    }

    if (reqProgram && req.user.program && req.user.program !== 'All' &&
        reqProgram.trim().toUpperCase() !== req.user.program.trim().toUpperCase()) {
        return res.status(403).json({
            success: false,
            message: `Access denied: You are only authorized for ${req.user.program} program`
        });
    }

    if (reqYear && req.user.year !== 'All' && String(reqYear).trim() !== String(req.user.year).trim()) {
        return res.status(403).json({
            success: false,
            message: `Access denied: You are only authorized for Year ${req.user.year}`
        });
    }

    if (reqClassId && req.user.classId && reqClassId.trim().toUpperCase() !== req.user.classId.trim().toUpperCase()) {
        return res.status(403).json({
            success: false,
            message: `Access denied: You are only authorized for ${req.user.classId}`
        });
    }

    next();
};

module.exports = { requireRole, enforceClassScope };
