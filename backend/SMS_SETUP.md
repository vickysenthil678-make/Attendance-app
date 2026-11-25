# Parent attendance SMS setup

The SMS feature uses the existing backend, MongoDB connection, staff JWT, and attendance API. No provider key is sent to the browser.

## MSG91 configuration

Set these variables in `backend/.env` (do not commit that file):

- `MSG91_AUTH_KEY`: MSG91 API auth key.
- `MSG91_ABSENCE_TEMPLATE_ID`: approved MSG91 Flow template ID for absence messages.
- `MSG91_CORRECTION_TEMPLATE_ID`: approved MSG91 Flow template ID for correcting an absence to present.
- `MSG91_DELIVERY_WEBHOOK_TOKEN`: random secret for authenticating delivery callbacks.

Configure approved, DLT-registered Flow templates and the institution's authorized sender in MSG91. The backend does not use a per-student consent flag or a separate manual authorization switch. Keep MSG91 credentials server-side. Do not configure or use an unapproved Flow template.

Both Flow templates must accept the following variables in order:

1. `VAR1`: parent/guardian name (or “Parent” if not provided).
2. `VAR2`: student name.
3. `VAR3`: attendance date (`YYYY-MM-DD`).
4. `VAR4`: class ID.

Use the approved SMS content and sender settings from the MSG91 account. The backend posts Flow requests to MSG91; configure the provider's delivery callback to POST JSON containing `request_id` and `status` to `/api/notifications/msg91/delivery` and include the `x-msg91-webhook-token` header. The callback maps delivered/success and failed/undelivered reports. Without a configured callback, accepted requests remain `sent`.

## Existing parent data, authorization, and permissions

- Staff submit attendance through the existing `/api/attendance/mark` route. SMS work starts only after MongoDB attendance persistence succeeds.
- Only absent attendance creates an absence notification. An absent-to-present correction creates a correction event only when its original absence notification was sent or delivered.
- Parent mobile numbers are read from the existing Student `parentPhone` field; staff do not re-enter them for notifications. Missing numbers are skipped, invalid numbers are failed, and explicit parent opt-outs are skipped.
- Absence SMS is attempted automatically after each attendance save. The per-student `smsConsent` field is not a send requirement; an explicit parent opt-out is honored and an admin can record it in the existing Student Data details view.
- MSG91 credentials and approved template IDs are the single institutional provider configuration. If required credentials or a template are missing, the attempt is recorded as failed without sending; an admin can retry after correcting configuration.
- A unique identity based on student ID, MongoDB attendance record ID, and event type prevents duplicate absence/correction messages. Existing skipped history is retained and delivery attempts/results are appended to its history.
- Admin notification history is limited to Computer Science UG/PG classes, masks parent numbers, and permits up to three explicit retries of failed notifications. Retries recheck the current opt-out status and parent number.

After confirming authorization and setting backend environment variables, restart the existing backend (`npm run dev` from `backend`). Run the focused provider/validation checks with `node scripts/test-parent-notifications.js` from `backend`. Do not test by sending real student/parent data to MSG91 from this development session.
