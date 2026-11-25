/**
 * StaffMessage.js
 * MongoDB model for internal messages between Staff and Admin.
 * Every conversation is linked to a StudentRequest.
 */

const mongoose = require('mongoose');

const staffMessageSchema = new mongoose.Schema(
    {
        /** The StudentRequest this conversation belongs to */
        requestId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'StudentRequest',
            required: true,
            index: true
        },
        /** MongoDB User _id of the sender */
        senderId: {
            type: mongoose.Schema.Types.Mixed,
            required: true
        },
        senderUsername: {
            type: String,
            required: true,
            trim: true
        },
        senderName: {
            type: String,
            trim: true,
            default: ''
        },
        senderRole: {
            type: String,
            enum: ['admin', 'staff'],
            required: true
        },
        message: {
            type: String,
            required: [true, 'Message body is required'],
            trim: true,
            maxlength: [2000, 'Message cannot exceed 2000 characters']
        },
        /** Brief context string shown in email notifications (e.g. student name + reg no) */
        requestContext: {
            type: String,
            trim: true,
            default: ''
        },
        /** Whether the recipient has read this message */
        isRead: {
            type: Boolean,
            default: false
        },
        readAt: {
            type: Date,
            default: null
        }
    },
    {
        timestamps: true
    }
);

staffMessageSchema.index({ requestId: 1, createdAt: 1 });
staffMessageSchema.index({ senderId: 1, isRead: 1 });

module.exports = mongoose.model('StaffMessage', staffMessageSchema);
