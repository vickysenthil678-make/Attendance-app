const MSG91_FLOW_URL = 'https://control.msg91.com/api/v5/flow/';

async function sendFlowSms({ templateId, mobile, parentName, studentName, attendanceDate, classId, eventType }) {
    const authKey = process.env.MSG91_AUTH_KEY;
    if (!authKey) {
        throw new Error('MSG91_AUTH_KEY is not configured');
    }

    const flowTemplateId = templateId ||
        (eventType === 'correction'
            ? process.env.MSG91_CORRECTION_TEMPLATE_ID
            : process.env.MSG91_ABSENCE_TEMPLATE_ID);
    if (!flowTemplateId) {
        throw new Error(`MSG91 ${eventType} template is not configured`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let response;
    try {
        response = await fetch(MSG91_FLOW_URL, {
            method: 'POST',
            headers: {
                authkey: authKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                template_id: flowTemplateId,
                recipients: [{
                    mobiles: mobile,
                    VAR1: parentName || 'Parent',
                    VAR2: studentName || 'Student',
                    VAR3: attendanceDate,
                    VAR4: classId
                }]
            }),
            signal: controller.signal
        });
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error('MSG91 request timed out');
        }
        throw new Error('MSG91 request could not be completed');
    } finally {
        clearTimeout(timeout);
    }

    let result = {};
    try {
        result = await response.json();
    } catch (error) {
        if (response.ok) {
            throw new Error('MSG91 returned an unreadable response');
        }
    }

    const providerType = String(result.type || '').toLowerCase();
    if (!response.ok || providerType !== 'success') {
        throw new Error(`MSG91 request failed (HTTP ${response.status})`);
    }

    return {
        messageId: String(result.request_id || result.requestId || result.message_id || '')
    };
}

module.exports = { sendFlowSms };
