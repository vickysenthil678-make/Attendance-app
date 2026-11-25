const crypto = require('crypto');
const ParentNotification = require('../models/ParentNotification');
const {
    MAX_RETRY_ATTEMPTS,
    maskPhoneNumber,
    retryNotification
} = require('../utils/parentNotificationService');
const Student = require('../models/Student');

const VALID_STATUSES = ['pending', 'sent', 'delivered', 'failed', 'skipped'];
const ALLOWED_CLASSES = ['CS1', 'CS2', 'CS3', 'PGCS1', 'PGCS2'];

function isValidDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function listNotifications(req, res) {
    try {
        const { dateFrom, dateTo, classId, department, status } = req.query;
        if ((dateFrom && !isValidDate(dateFrom)) || (dateTo && !isValidDate(dateTo))) {
            return res.status(400).json({ success: false, message: 'Date filters must use a valid YYYY-MM-DD date' });
        }
        if (dateFrom && dateTo && dateFrom > dateTo) {
            return res.status(400).json({ success: false, message: 'Start date must be on or before end date' });
        }
        if (department && department !== 'Computer Science') {
            return res.status(400).json({ success: false, message: 'Notification history is limited to Computer Science' });
        }
        if (classId && !ALLOWED_CLASSES.includes(String(classId).trim().toUpperCase())) {
            return res.status(400).json({ success: false, message: 'Invalid Computer Science class filter' });
        }
        if (status && !VALID_STATUSES.includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid notification status filter' });
        }

        const filter = {
            department: 'Computer Science',
            program: { $in: ['UG', 'PG'] }
        };
        if (classId) filter.classId = String(classId).trim().toUpperCase();
        if (status) filter.status = status;
        if (dateFrom || dateTo) {
            filter.attendanceDate = {};
            if (dateFrom) filter.attendanceDate.$gte = dateFrom;
            if (dateTo) filter.attendanceDate.$lte = dateTo;
        }

        const notifications = await ParentNotification.find(filter)
            .sort({ createdAt: -1 })
            .limit(200)
            .select('-parentName -eventKey')
            .lean();
        const students = await Student.find({
            studentId: { $in: [...new Set(notifications.map(notification => notification.studentId))] },
            department: 'Computer Science',
            program: { $in: ['UG', 'PG'] }
        }).select('studentId department program year parentPhone').lean();
        const currentPhonesByStudent = new Map(students.map(student => [
            `${student.department}:${student.program}:${student.year}:${student.studentId}`,
            student.parentPhone
        ]));

        return res.status(200).json({
            success: true,
            notifications: notifications.map(({ parentPhone, ...notification }) => {
                const currentParentPhone = currentPhonesByStudent.get(
                    `${notification.department}:${notification.program}:${notification.year}:${notification.studentId}`
                );
                const legacyConsentSkip = notification.status === 'skipped' &&
                    notification.failureReason === 'SMS consent has not been provided';
                const legacyAuthorizationSkip = notification.status === 'skipped' &&
                    notification.failureReason === 'Institutional parent SMS authorization is not enabled';
                const legacyMissingPhone = [
                    'Parent mobile number is missing',
                    'Parent mobile number missing'
                ].includes(notification.failureReason);
                const statusHistory = notification.statusHistory && notification.statusHistory.length
                    ? notification.statusHistory
                    : legacyConsentSkip || legacyAuthorizationSkip || legacyMissingPhone
                        ? [{
                            status: 'skipped',
                            action: 'legacy_skip',
                            reason: notification.failureReason,
                            at: notification.createdAt
                        }]
                        : [];
                return {
                    ...notification,
                    failureReason: legacyConsentSkip
                        ? 'Previously skipped under the legacy consent policy; it will not be sent automatically'
                        : legacyAuthorizationSkip
                            ? 'Not sent under the previous authorization setting; it will not be sent automatically'
                            : legacyMissingPhone
                                ? 'Parent mobile number missing'
                                : notification.failureReason,
                    statusHistory,
                    parentPhoneMasked: maskPhoneNumber(parentPhone || currentParentPhone),
                    canRetry: notification.status === 'failed' &&
                        notification.attempts < MAX_RETRY_ATTEMPTS
                };
            })
        });
    } catch (error) {
        console.error('listNotifications error:', error);
        return res.status(500).json({ success: false, message: 'Failed to retrieve notification history' });
    }
}

async function retryFailedNotification(req, res) {
    try {
        const notification = await retryNotification(req.params.id);
        if (!notification) {
            return res.status(404).json({
                success: false,
                message: 'Failed notification not found, already processing, or retry limit reached'
            });
        }
        return res.status(200).json({
            success: true,
            message: notification.status === 'sent'
                ? 'Notification sent successfully'
                : notification.status === 'skipped'
                    ? notification.failureReason
                    : notification.failureReason || 'Notification retry failed',
            status: notification.status
        });
    } catch (error) {
        console.error('retryFailedNotification error:', error);
        return res.status(500).json({ success: false, message: 'Failed to retry notification' });
    }
}

function safeTokenEquals(actual, expected) {
    if (!actual || !expected) return false;
    const actualBuffer = Buffer.from(String(actual));
    const expectedBuffer = Buffer.from(String(expected));
    return actualBuffer.length === expectedBuffer.length &&
        crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

async function updateMsg91DeliveryStatus(req, res) {
    try {
        const webhookToken = process.env.MSG91_DELIVERY_WEBHOOK_TOKEN;
        if (!webhookToken) {
            return res.status(503).json({ success: false, message: 'Delivery callback is not configured' });
        }
        if (!safeTokenEquals(req.get('x-msg91-webhook-token'), webhookToken)) {
            return res.status(401).json({ success: false, message: 'Invalid delivery callback credentials' });
        }

        const payload = req.body || {};
        const messageId = payload.request_id || payload.requestId || payload.message_id || payload.messageId;
        const providerStatus = String(payload.status || payload.delivery_status || '').toLowerCase();
        const status = ['delivered', 'delivrd', 'success'].includes(providerStatus)
            ? 'delivered'
            : ['failed', 'failure', 'rejected', 'rejectd', 'undelivered', 'undeliv'].includes(providerStatus)
                ? 'failed'
                : null;

        if (!messageId || !status) {
            return res.status(400).json({ success: false, message: 'A supported provider message ID and delivery status are required' });
        }

        const result = await ParentNotification.updateOne(
            { providerMessageId: String(messageId), status: { $in: ['sent', 'pending'] } },
            {
                $set: {
                    status,
                    failureReason: status === 'failed' ? 'MSG91 delivery report reported failure' : ''
                },
                $push: {
                    statusHistory: {
                        status,
                        action: 'msg91_delivery_report',
                        reason: status === 'failed' ? 'MSG91 delivery report reported failure' : '',
                        at: new Date()
                    }
                }
            }
        );
        return res.status(200).json({ success: true, updated: result.modifiedCount > 0 });
    } catch (error) {
        console.error('updateMsg91DeliveryStatus error:', error);
        return res.status(500).json({ success: false, message: 'Failed to update delivery status' });
    }
}

module.exports = {
    listNotifications,
    retryFailedNotification,
    updateMsg91DeliveryStatus
};
