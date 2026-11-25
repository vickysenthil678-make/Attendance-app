/**
 * emailService.js
 * Reusable Nodemailer email service using Gmail SMTP.
 * Credentials are read from environment variables only — never from frontend code.
 */

const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
    if (transporter) return transporter;

    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!user || !pass) {
        throw new Error('SMTP_USER and SMTP_PASS must be set in backend/.env');
    }

    transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: false,          // STARTTLS on port 587
        auth: { user, pass }
    });

    return transporter;
}

/**
 * Send a single email.
 * @param {object} options
 * @param {string|string[]} options.to   - Recipient email(s)
 * @param {string}          options.subject
 * @param {string}          options.html - HTML body
 * @param {string}          [options.text] - Plain-text fallback
 * @returns {Promise<{messageId: string}>}
 */
async function sendEmail({ to, subject, html, text }) {
    const transport = getTransporter();
    const from = `"Attendance Maintenance System" <${process.env.SMTP_USER}>`;

    const info = await transport.sendMail({
        from,
        to: Array.isArray(to) ? to.join(', ') : to,
        subject,
        html,
        text: text || html.replace(/<[^>]+>/g, ' ')
    });

    console.log(`Email sent: ${info.messageId} → ${to}`);
    return { messageId: info.messageId };
}

/* ─────────────────────────────────────────────────────────────
   Pre-built template senders
   ───────────────────────────────────────────────────────────── */

/**
 * Notify admin that a new student addition request was submitted.
 */
async function sendNewRequestEmailToAdmin(request, staffEmail) {
    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminEmail) {
        console.warn('ADMIN_EMAIL not set — skipping admin notification email');
        return null;
    }

    const reqDate = new Date(request.createdAt || Date.now()).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;background:#f4f6f9;margin:0;padding:0;">
<div style="max-width:600px;margin:30px auto;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 4px 15px rgba(0,0,0,0.1);">
  <div style="background:#1e3a5f;padding:24px 30px;text-align:center;">
    <h1 style="color:#ffffff;margin:0;font-size:22px;">Attendance Maintenance System</h1>
    <p style="color:#90cdf4;margin:6px 0 0;font-size:14px;">Thanthai Hans Roever College (Autonomous)</p>
  </div>
  <div style="padding:28px 30px;">
    <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:14px 18px;border-radius:6px;margin-bottom:22px;">
      <strong style="color:#92400e;font-size:15px;">⚠ New Student Addition Request — Approval Required</strong>
    </div>
    <p style="color:#374151;font-size:15px;">A staff member has submitted a new student registration request that requires your approval.</p>

    <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px;">
      <tr style="background:#eff6ff;">
        <td style="padding:10px 14px;font-weight:bold;color:#1e40af;width:40%;border-bottom:1px solid #dbeafe;">Staff Name</td>
        <td style="padding:10px 14px;color:#1f2937;border-bottom:1px solid #dbeafe;">${request.requestedByName || '—'}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;font-weight:bold;color:#1e40af;border-bottom:1px solid #dbeafe;">Staff Username</td>
        <td style="padding:10px 14px;color:#1f2937;border-bottom:1px solid #dbeafe;">${request.requestedBy || '—'}</td>
      </tr>
      ${staffEmail ? `<tr style="background:#eff6ff;">
        <td style="padding:10px 14px;font-weight:bold;color:#1e40af;border-bottom:1px solid #dbeafe;">Staff Email</td>
        <td style="padding:10px 14px;color:#1f2937;border-bottom:1px solid #dbeafe;">${staffEmail}</td>
      </tr>` : ''}
      <tr ${staffEmail ? '' : 'style="background:#eff6ff;"'}>
        <td style="padding:10px 14px;font-weight:bold;color:#1e40af;border-bottom:1px solid #dbeafe;">Student Name</td>
        <td style="padding:10px 14px;color:#1f2937;font-weight:bold;border-bottom:1px solid #dbeafe;">${request.studentName || '—'}</td>
      </tr>
      <tr ${staffEmail ? 'style="background:#eff6ff;"' : ''}>
        <td style="padding:10px 14px;font-weight:bold;color:#1e40af;border-bottom:1px solid #dbeafe;">Register Number</td>
        <td style="padding:10px 14px;color:#1f2937;font-weight:bold;border-bottom:1px solid #dbeafe;">${request.studentRegisterNumber || request.studentId || '—'}</td>
      </tr>
      <tr ${staffEmail ? '' : 'style="background:#eff6ff;"'}>
        <td style="padding:10px 14px;font-weight:bold;color:#1e40af;border-bottom:1px solid #dbeafe;">Department</td>
        <td style="padding:10px 14px;color:#1f2937;border-bottom:1px solid #dbeafe;">${request.department || '—'}</td>
      </tr>
      <tr ${staffEmail ? 'style="background:#eff6ff;"' : ''}>
        <td style="padding:10px 14px;font-weight:bold;color:#1e40af;border-bottom:1px solid #dbeafe;">Program</td>
        <td style="padding:10px 14px;color:#1f2937;border-bottom:1px solid #dbeafe;">${request.program || 'UG'}</td>
      </tr>
      <tr ${staffEmail ? '' : 'style="background:#eff6ff;"'}>
        <td style="padding:10px 14px;font-weight:bold;color:#1e40af;border-bottom:1px solid #dbeafe;">Academic Year</td>
        <td style="padding:10px 14px;color:#1f2937;border-bottom:1px solid #dbeafe;">Year ${request.year || '—'} (${request.academicYear || '—'})</td>
      </tr>
      <tr ${staffEmail ? 'style="background:#eff6ff;"' : ''}>
        <td style="padding:10px 14px;font-weight:bold;color:#1e40af;border-bottom:1px solid #dbeafe;">Class</td>
        <td style="padding:10px 14px;color:#1f2937;border-bottom:1px solid #dbeafe;">${request.classId || '—'}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;font-weight:bold;color:#1e40af;border-bottom:1px solid #dbeafe;">Request Date</td>
        <td style="padding:10px 14px;color:#1f2937;border-bottom:1px solid #dbeafe;">${reqDate}</td>
      </tr>
      ${request.reason ? `<tr style="background:#eff6ff;">
        <td style="padding:10px 14px;font-weight:bold;color:#1e40af;">Staff Notes</td>
        <td style="padding:10px 14px;color:#1f2937;">${request.reason}</td>
      </tr>` : ''}
    </table>

    <div style="background:#f0fdf4;border:1px solid #86efac;padding:14px 18px;border-radius:6px;margin-top:18px;">
      <p style="margin:0;color:#166534;font-size:14px;">
        Please log in to the <strong>Admin Dashboard → Student Registration Requests</strong> to approve or reject this request.
      </p>
    </div>
  </div>
  <div style="background:#f9fafb;padding:14px 30px;text-align:center;border-top:1px solid #e5e7eb;">
    <p style="margin:0;color:#6b7280;font-size:12px;">Thanthai Hans Roever College Attendance Maintenance System · Automated Notification</p>
  </div>
</div>
</body>
</html>`;

    return sendEmail({
        to: adminEmail,
        subject: `New Student Addition Request - Approval Required | ${request.studentName} (${request.studentRegisterNumber || request.studentId})`,
        html
    });
}

/**
 * Notify staff that their student addition request was approved.
 */
async function sendApprovalEmailToStaff(request, staffEmail) {
    const recipient = process.env.STAFF_NOTIFICATION_EMAIL || staffEmail;
    if (!recipient) return null;

    const reviewedDate = new Date(request.approvedAt || request.reviewedAt || Date.now()).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;background:#f4f6f9;margin:0;padding:0;">
<div style="max-width:600px;margin:30px auto;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 4px 15px rgba(0,0,0,0.1);">
  <div style="background:#1e3a5f;padding:24px 30px;text-align:center;">
    <h1 style="color:#ffffff;margin:0;font-size:22px;">Attendance Maintenance System</h1>
    <p style="color:#90cdf4;margin:6px 0 0;font-size:14px;">Thanthai Hans Roever College (Autonomous)</p>
  </div>
  <div style="padding:28px 30px;">
    <div style="background:#f0fdf4;border-left:4px solid #22c55e;padding:14px 18px;border-radius:6px;margin-bottom:22px;">
      <strong style="color:#166534;font-size:16px;">✅ Student Registration Request Approved!</strong>
    </div>
    <p style="color:#374151;font-size:15px;">Your student registration request has been approved by the Admin. You can now complete the student registration in the system.</p>

    <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px;">
      <tr style="background:#eff6ff;">
        <td style="padding:10px 14px;font-weight:bold;color:#1e40af;width:40%;border-bottom:1px solid #dbeafe;">Student Name</td>
        <td style="padding:10px 14px;color:#1f2937;font-weight:bold;border-bottom:1px solid #dbeafe;">${request.studentName || '—'}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;font-weight:bold;color:#1e40af;border-bottom:1px solid #dbeafe;">Register Number</td>
        <td style="padding:10px 14px;color:#1f2937;font-weight:bold;border-bottom:1px solid #dbeafe;">${request.studentRegisterNumber || request.studentId || '—'}</td>
      </tr>
      <tr style="background:#eff6ff;">
        <td style="padding:10px 14px;font-weight:bold;color:#1e40af;border-bottom:1px solid #dbeafe;">Department / Class</td>
        <td style="padding:10px 14px;color:#1f2937;border-bottom:1px solid #dbeafe;">${request.department} — ${request.classId || 'Year ' + request.year}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;font-weight:bold;color:#1e40af;border-bottom:1px solid #dbeafe;">Approved By</td>
        <td style="padding:10px 14px;color:#1f2937;border-bottom:1px solid #dbeafe;">${request.approvedBy || request.reviewedBy || 'Admin'}</td>
      </tr>
      <tr style="background:#eff6ff;">
        <td style="padding:10px 14px;font-weight:bold;color:#1e40af;border-bottom:1px solid #dbeafe;">Approved At</td>
        <td style="padding:10px 14px;color:#1f2937;border-bottom:1px solid #dbeafe;">${reviewedDate}</td>
      </tr>
      ${request.adminRemarks ? `<tr>
        <td style="padding:10px 14px;font-weight:bold;color:#1e40af;">Admin Remarks</td>
        <td style="padding:10px 14px;color:#1f2937;">${request.adminRemarks}</td>
      </tr>` : ''}
    </table>

    <div style="background:#fef3c7;border:1px solid #fcd34d;padding:14px 18px;border-radius:6px;margin-top:18px;">
      <p style="margin:0;color:#92400e;font-size:14px;">
        <strong>Next step:</strong> Open the Attendance System → <em>Request Approval Status</em> → click <em>Complete Registration</em> to add the student to your class.
      </p>
    </div>
  </div>
  <div style="background:#f9fafb;padding:14px 30px;text-align:center;border-top:1px solid #e5e7eb;">
    <p style="margin:0;color:#6b7280;font-size:12px;">Thanthai Hans Roever College Attendance Maintenance System · Automated Notification</p>
  </div>
</div>
</body>
</html>`;

    return sendEmail({
        to: recipient,
        subject: `✅ Request Approved: ${request.studentName} (${request.studentRegisterNumber || request.studentId}) — Ready for Registration`,
        html
    });
}

/**
 * Notify staff that their student addition request was rejected.
 */
async function sendRejectionEmailToStaff(request, staffEmail) {
    if (!staffEmail) return null;

    const rejectedDate = new Date(request.rejectedAt || request.reviewedAt || Date.now()).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;background:#f4f6f9;margin:0;padding:0;">
<div style="max-width:600px;margin:30px auto;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 4px 15px rgba(0,0,0,0.1);">
  <div style="background:#1e3a5f;padding:24px 30px;text-align:center;">
    <h1 style="color:#ffffff;margin:0;font-size:22px;">Attendance Maintenance System</h1>
    <p style="color:#90cdf4;margin:6px 0 0;font-size:14px;">Thanthai Hans Roever College (Autonomous)</p>
  </div>
  <div style="padding:28px 30px;">
    <div style="background:#fef2f2;border-left:4px solid #ef4444;padding:14px 18px;border-radius:6px;margin-bottom:22px;">
      <strong style="color:#991b1b;font-size:16px;">❌ Student Registration Request Rejected</strong>
    </div>
    <p style="color:#374151;font-size:15px;">Your student registration request has been reviewed and rejected by the Admin. Please see the reason below and contact the Admin if you have questions.</p>

    <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px;">
      <tr style="background:#eff6ff;">
        <td style="padding:10px 14px;font-weight:bold;color:#1e40af;width:40%;border-bottom:1px solid #dbeafe;">Student Name</td>
        <td style="padding:10px 14px;color:#1f2937;border-bottom:1px solid #dbeafe;">${request.studentName || '—'}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;font-weight:bold;color:#1e40af;border-bottom:1px solid #dbeafe;">Register Number</td>
        <td style="padding:10px 14px;color:#1f2937;border-bottom:1px solid #dbeafe;">${request.studentRegisterNumber || request.studentId || '—'}</td>
      </tr>
      <tr style="background:#eff6ff;">
        <td style="padding:10px 14px;font-weight:bold;color:#1e40af;border-bottom:1px solid #dbeafe;">Department / Class</td>
        <td style="padding:10px 14px;color:#1f2937;border-bottom:1px solid #dbeafe;">${request.department} — ${request.classId || 'Year ' + request.year}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;font-weight:bold;color:#1e40af;border-bottom:1px solid #dbeafe;">Rejected By</td>
        <td style="padding:10px 14px;color:#1f2937;border-bottom:1px solid #dbeafe;">${request.rejectedBy || request.reviewedBy || 'Admin'}</td>
      </tr>
      <tr style="background:#eff6ff;">
        <td style="padding:10px 14px;font-weight:bold;color:#1e40af;border-bottom:1px solid #dbeafe;">Rejected At</td>
        <td style="padding:10px 14px;color:#1f2937;border-bottom:1px solid #dbeafe;">${rejectedDate}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;font-weight:bold;color:#991b1b;">Reason for Rejection</td>
        <td style="padding:10px 14px;color:#991b1b;font-weight:bold;">${request.rejectionReason || request.adminRemarks || 'No reason provided'}</td>
      </tr>
    </table>

    <div style="background:#fef3c7;border:1px solid #fcd34d;padding:14px 18px;border-radius:6px;margin-top:18px;">
      <p style="margin:0;color:#92400e;font-size:14px;">
        You may submit a new corrected request by logging into the Attendance System and going to <em>Student Registration Request</em>.
      </p>
    </div>
  </div>
  <div style="background:#f9fafb;padding:14px 30px;text-align:center;border-top:1px solid #e5e7eb;">
    <p style="margin:0;color:#6b7280;font-size:12px;">Thanthai Hans Roever College Attendance Maintenance System · Automated Notification</p>
  </div>
</div>
</body>
</html>`;

    return sendEmail({
        to: staffEmail,
        subject: `❌ Request Rejected: ${request.studentName} (${request.studentRegisterNumber || request.studentId})`,
        html
    });
}

/**
 * Notify recipient that a new internal message arrived.
 * @param {object} message  - StaffMessage document
 * @param {string} toEmail  - Recipient's email
 * @param {string} toName   - Recipient's display name
 */
async function sendNewMessageEmail(message, toEmail, toName) {
    if (!toEmail) return null;

    const sentDate = new Date(message.createdAt || Date.now()).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const isAdminSender = message.senderRole === 'admin';

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;background:#f4f6f9;margin:0;padding:0;">
<div style="max-width:600px;margin:30px auto;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 4px 15px rgba(0,0,0,0.1);">
  <div style="background:#1e3a5f;padding:24px 30px;text-align:center;">
    <h1 style="color:#ffffff;margin:0;font-size:22px;">Attendance Maintenance System</h1>
    <p style="color:#90cdf4;margin:6px 0 0;font-size:14px;">Thanthai Hans Roever College (Autonomous)</p>
  </div>
  <div style="padding:28px 30px;">
    <div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:14px 18px;border-radius:6px;margin-bottom:22px;">
      <strong style="color:#1e40af;font-size:15px;">💬 New Message from ${isAdminSender ? 'Admin' : message.senderName || 'Staff'}</strong>
    </div>
    <p style="color:#374151;font-size:15px;">Hello <strong>${toName || 'User'}</strong>, you have received a new message.</p>

    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:18px;margin:20px 0;">
      <div style="display:flex;justify-content:space-between;margin-bottom:10px;">
        <span style="color:#64748b;font-size:13px;"><strong>From:</strong> ${message.senderName || message.senderUsername || '—'} (${isAdminSender ? 'Admin' : 'Staff'})</span>
        <span style="color:#64748b;font-size:13px;">${sentDate}</span>
      </div>
      ${message.requestContext ? `<p style="color:#64748b;font-size:13px;margin:0 0 10px;"><strong>Re:</strong> Student Request — ${message.requestContext}</p>` : ''}
      <div style="background:#ffffff;border-left:3px solid #3b82f6;padding:12px 16px;border-radius:4px;color:#1f2937;font-size:15px;line-height:1.6;">
        ${message.message}
      </div>
    </div>

    <div style="background:#f0fdf4;border:1px solid #86efac;padding:14px 18px;border-radius:6px;margin-top:18px;">
      <p style="margin:0;color:#166534;font-size:14px;">
        Log in to the Attendance System to read and reply to this message.
      </p>
    </div>
  </div>
  <div style="background:#f9fafb;padding:14px 30px;text-align:center;border-top:1px solid #e5e7eb;">
    <p style="margin:0;color:#6b7280;font-size:12px;">Thanthai Hans Roever College Attendance Maintenance System · Automated Notification</p>
  </div>
</div>
</body>
</html>`;

    return sendEmail({
        to: toEmail,
        subject: `New Message from ${isAdminSender ? 'Admin' : message.senderName || 'Staff'} — Attendance Maintenance System`,
        html
    });
}

module.exports = {
    sendEmail,
    sendNewRequestEmailToAdmin,
    sendApprovalEmailToStaff,
    sendRejectionEmailToStaff,
    sendNewMessageEmail
};
