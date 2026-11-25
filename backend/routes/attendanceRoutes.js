const express = require('express');
const router = express.Router();
const {
    getAttendance,
    markAttendance,
    uploadExcel
} = require('../controllers/attendanceController');
const {
    getPeriodAttendance,
    getPeriodReport,
    markPeriodAttendance,
    unlockPeriodAttendance
} = require('../controllers/periodAttendanceController');


const { requireRole, enforceClassScope } = require('../middleware/roleMiddleware');

const { protect } = require('../middleware/authMiddleware');

// Multer setup for Excel uploads
const multer = require('multer');
const path = require('path');
const upload = multer({
  dest: path.join(__dirname, '../../uploads'),
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xlsx' || ext === '.xls') cb(null, true);
    else cb(new Error('Only .xlsx/.xls files allowed'));
  },
  limits: { fileSize: 5 * 1024 * 1024 }
});

router.use(protect);

router.get('/periods/report', enforceClassScope, getPeriodReport);
router.get('/periods', enforceClassScope, getPeriodAttendance);
router.post('/periods/mark', enforceClassScope, markPeriodAttendance);
router.patch('/periods/unlock', requireRole('admin'), unlockPeriodAttendance);
router.get('/', enforceClassScope, getAttendance);
router.post('/mark', enforceClassScope, (req, res, next) => {
    if (req.body && req.body.period !== undefined && req.body.period !== null && req.body.period !== '') {
        return markPeriodAttendance(req, res, next);
    }
    return markAttendance(req, res, next);
});
router.post('/upload', requireRole('staff'), upload.single('file'), uploadExcel);


module.exports = router;
