/**
 * staffMessageRoutes.js
 * Routes for Staff ↔ Admin internal messaging.
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { sendMessage, getMessages, getUnreadCount } = require('../controllers/staffMessageController');

router.use(protect);

// GET  /api/messages/unread-count  — unread count for logged-in user
router.get('/unread-count', getUnreadCount);

// GET  /api/messages/:requestId   — conversation for a request
router.get('/:requestId', getMessages);

// POST /api/messages/:requestId   — send a message
router.post('/:requestId', sendMessage);

module.exports = router;
