const express = require('express');
const {
    listNotifications,
    retryFailedNotification,
    updateMsg91DeliveryStatus
} = require('../controllers/parentNotificationController');
const { protect } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');

const router = express.Router();

router.post('/msg91/delivery', updateMsg91DeliveryStatus);
router.use(protect, requireRole('admin'));
router.get('/', listNotifications);
router.post('/:id/retry', retryFailedNotification);

module.exports = router;
