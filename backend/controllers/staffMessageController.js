/**
 * staffMessageController.js
 * Handles internal messaging between Staff and Admin,
 * linked to StudentRequest records.
 */

const StaffMessage = require('../models/StaffMessage');
const StudentRequest = require('../models/StudentRequest');
const User = require('../models/User');
const { sendNewMessageEmail } = require('../utils/emailService');

/* ─────────────────────────────────────────────────────────────
   POST /api/messages/:requestId
   Send a message on a request conversation.
   Staff can only message on their own requests.
   Admin can message on any request.
   ───────────────────────────────────────────────────────────── */
exports.sendMessage = async (req, res) => {
    try {
        const { requestId } = req.params;
        const { message } = req.body;

        if (!message || !String(message).trim()) {
            return res.status(400).json({ success: false, message: 'Message body is required' });
        }
        if (String(message).trim().length > 2000) {
            return res.status(400).json({ success: false, message: 'Message cannot exceed 2000 characters' });
        }

        const request = await StudentRequest.findById(requestId);
        if (!request) {
            return res.status(404).json({ success: false, message: 'Student request not found' });
        }

        // Staff may only message on their own request
        if (req.user.role === 'staff') {
            const isOwner = (request.requestedBy === req.user.username) ||
                            (String(request.staffId) === String(req.user._id || req.user.id));
            if (!isOwner) {
                return res.status(403).json({ success: false, message: 'Access denied: you can only message on your own requests' });
            }
        }

        const requestContext = `${request.studentName} (${request.studentRegisterNumber || request.studentId})`;

        const msg = await StaffMessage.create({
            requestId: request._id,
            senderId: req.user._id || req.user.id,
            senderUsername: req.user.username,
            senderName: req.user.name || req.user.username,
            senderRole: req.user.role,
            message: String(message).trim(),
            requestContext
        });

        // Send email notification to the other party (fire-and-forget)
        try {
            if (req.user.role === 'staff') {
                // Staff sent a message → notify Admin
                const adminEmail = process.env.ADMIN_EMAIL;
                if (adminEmail) {
                    await sendNewMessageEmail(msg, adminEmail, 'Admin');
                }
            } else {
                // Admin sent a message → notify Staff
                const staffEmail = request.staffEmail;
                if (staffEmail) {
                    await sendNewMessageEmail(msg, staffEmail, request.requestedByName || request.requestedBy);
                }
            }
        } catch (emailErr) {
            console.error('Message email notification failed (non-fatal):', emailErr.message);
        }

        return res.status(201).json({ success: true, message: 'Message sent', data: msg });
    } catch (error) {
        console.error('sendMessage error:', error);
        return res.status(500).json({ success: false, message: 'Failed to send message' });
    }
};

/* ─────────────────────────────────────────────────────────────
   GET /api/messages/:requestId
   Get all messages for a request conversation.
   Also marks all messages from the other party as read.
   ───────────────────────────────────────────────────────────── */
exports.getMessages = async (req, res) => {
    try {
        const { requestId } = req.params;

        const request = await StudentRequest.findById(requestId).lean();
        if (!request) {
            return res.status(404).json({ success: false, message: 'Student request not found' });
        }

        // Staff may only read their own request's messages
        if (req.user.role === 'staff') {
            const isOwner = (request.requestedBy === req.user.username) ||
                            (String(request.staffId) === String(req.user._id || req.user.id));
            if (!isOwner) {
                return res.status(403).json({ success: false, message: 'Access denied' });
            }
        }

        const messages = await StaffMessage.find({ requestId: request._id })
            .sort({ createdAt: 1 })
            .lean();

        // Mark unread messages sent by the other role as read
        const myRole = req.user.role;
        const unreadIds = messages
            .filter(m => m.senderRole !== myRole && !m.isRead)
            .map(m => m._id);

        if (unreadIds.length > 0) {
            await StaffMessage.updateMany(
                { _id: { $in: unreadIds } },
                { $set: { isRead: true, readAt: new Date() } }
            );
        }

        return res.status(200).json({ success: true, messages });
    } catch (error) {
        console.error('getMessages error:', error);
        return res.status(500).json({ success: false, message: 'Failed to fetch messages' });
    }
};

/* ─────────────────────────────────────────────────────────────
   GET /api/messages/unread-count
   Returns total unread message count for the logged-in user.
   ───────────────────────────────────────────────────────────── */
exports.getUnreadCount = async (req, res) => {
    try {
        const myRole = req.user.role;
        // Messages sent by the OTHER role that are unread
        const oppositeRole = myRole === 'admin' ? 'staff' : 'admin';

        let query = { senderRole: oppositeRole, isRead: false };

        // Staff: only count unread messages on their own requests
        if (myRole === 'staff') {
            const myRequests = await StudentRequest.find({
                $or: [
                    { requestedBy: req.user.username },
                    { staffId: req.user._id || req.user.id }
                ]
            }).select('_id').lean();
            const myRequestIds = myRequests.map(r => r._id);
            query.requestId = { $in: myRequestIds };
        }

        const count = await StaffMessage.countDocuments(query);
        return res.status(200).json({ success: true, unreadCount: count });
    } catch (error) {
        console.error('getUnreadCount error:', error);
        return res.status(500).json({ success: false, message: 'Failed to fetch unread count' });
    }
};
