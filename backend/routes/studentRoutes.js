const express = require('express');
const router = express.Router();
const multer = require('multer');
const {
    getStudents,
    getAllYearsStudents,
    getStudentById,
    addStudent,
    batchAddStudents,
    uploadExcel,
    deleteStudent,
    getStudentPhoto,
    uploadStudentPhoto,
    deleteStudentPhoto,
    updateStudent,
    updateParentSmsOptOut
} = require('../controllers/studentController');
const { protect } = require('../middleware/authMiddleware');
const { requireRole, enforceClassScope } = require('../middleware/roleMiddleware');

// Configure multer for in-memory file parsing
const storage = multer.memoryStorage();
const photoUpload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024, files: 1 }
});
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        if (
            file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
            file.mimetype === 'application/vnd.ms-excel' ||
            file.originalname.match(/\.(xlsx|xls)$/i)
        ) {
            cb(null, true);
        } else {
            cb(new Error('Only Excel files (.xlsx, .xls) are permitted'), false);
        }
    }
});

const handlePhotoUpload = (req, res, next) => {
    photoUpload.single('photo')(req, res, error => {
        if (!error) return next();

        const statusCode = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        return res.status(statusCode).json({ success: false, message: error.message });
    });
};

router.use(protect);

router.get('/', enforceClassScope, getStudents);
router.get('/allyears', getAllYearsStudents);
router.get('/:id/photo', requireRole('staff', 'admin'), getStudentPhoto);
router.put('/:id/photo', requireRole('staff'), handlePhotoUpload, uploadStudentPhoto);
router.delete('/:id/photo', requireRole('staff'), deleteStudentPhoto);
router.post('/', requireRole('admin'), upload.single('photo'), addStudent);
router.post('/register', requireRole('admin', 'staff'), enforceClassScope, addStudent);
router.post('/batch', enforceClassScope, batchAddStudents);
router.post('/upload', upload.single('file'), enforceClassScope, uploadExcel);
router.patch('/:id/parent-sms-opt-out', requireRole('admin'), updateParentSmsOptOut);
router.get('/:id', getStudentById);
router.put('/:id', requireRole('admin', 'staff'), enforceClassScope, updateStudent);
router.delete('/:id', requireRole('admin','staff'), enforceClassScope, deleteStudent);

module.exports = router;
