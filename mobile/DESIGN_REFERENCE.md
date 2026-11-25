# Website-to-React-Native page map

This reference was prepared from the HTML, linked/shared CSS, inline page styles,
page scripts, Expo screens, backend routes, and MongoDB models in this project.
It distinguishes user-facing website pages from diagnostic pages; diagnostic
tools are not product screens.

## Shared appearance and assets

- The linked website stylesheet sets a `Segoe UI, Arial, sans-serif` font and a
  135-degree background gradient from `#667eea` to `#764ba2`.
- The shared header is white, centered between two logos, and has a 2px
  `#e5e7eb` lower border and a subtle shadow. Header text uses dark gray/blue
  colors; the system title is uppercase.
- Common inputs use translucent white fill, a translucent white border, 8px
  corners, and white text. Common buttons are blue `#2563eb` pills with red
  `#dc2626`, green `#16a34a`, and purple `#7c3aed` variants. Tables use
  translucent white row dividers.
- The shared CSS has mobile rules for a compact header, full-width buttons,
  44px touch targets, and horizontally scrollable tables. Several pages also
  define their own inline styles and responsive layouts.
- The website logo assets (`front End/logo.png`, `front End/img/Hans.png`) are
  byte-identical to the Expo assets (`mobile/assets/college-logo.png`,
  `mobile/assets/college-mark.png`), respectively.
- `mobile/src/ui.tsx` reuses the gradient, white college header, logos, and
  shared button/input colors. It uses React Native's platform-default font and
  a general translucent rounded `Card`; the website instead has page-specific
  layouts, including transparent sections and non-card pages. Those are known
  visual differences, not evidence of a pixel-identical comparison.

## User-facing pages

| Website page | Original content/layout | React Native mapping | Observed gap or note |
|---|---|---|---|
| `index.html` | College header, gradient background, centered username/password login and Login button. | `SignInScreen` | RN adds a card/error/loading presentation. `css/index.css` contains additional login styles but is not linked by this HTML page. |
| `admin.html` | Compact centered admin heading; two-column grid of blue rounded actions and red logout. | `DashboardScreen` (admin) | The RN dashboard has role actions, but its generic card/layout differs from the page's compact uncarded grid. |
| `home.html` | Staff identity and centered, wrapped rows of Mark Attendance, registration request, status, student-data, and logout buttons. | `DashboardScreen` (staff) | RN routes the same principal workflows; it uses different button/card sizing and layout. |
| `class-selection.html` | Centered class-selection heading, staff name, class buttons, and red logout. | `ClassSelectScreen` | Class choices are derived from role/program; website styling is more page-specific. |
| `attendance.html` | Class banner, fixed staff date (admin can change), present/absent student roster table, stats, submit and back controls. | `AttendanceScreen` (`mode: daily` or `period`) | RN renders roster rows with switches rather than the website table/toggle. Staff periods are available only in their India-time windows and show the saved absent-student roll numbers. |
| `register.html` | Admin-only individual student form: name, register number, department, year, Add Student, Clear Form, Back. | `StudentFormScreen` | The RN form is reached from Students and includes additional fields; the original page does not expose those fields. |
| `request-student.html` | Staff identity/class, register number, name, department/year/class, optional phones/reason, submit/back, and loading/message states. | `RequestFormScreen` | RN takes department/program/year/class from the authenticated user rather than presenting the website's department/year selectors. |
| `my-requests.html` | Staff badge, search/status filters, request table, refresh, new request, and a completion modal for approved requests. | `RequestsScreen` | RN combines request status and completion into one card/list screen instead of the original table/modal layout. |
| `ug-registration-status.html` | UG-scoped staff status page with search/status toolbar, request table, and registration-completion modal. | `RequestsScreen` | Combined with the general staff request page; no separate UG screen. |
| `pg-registration-status.html` | PG-scoped counterpart of the UG status page. | `RequestsScreen` | Combined with the general staff request page; no separate PG screen. |
| `admin-student-requests.html` | Admin request filters, search, refresh, requests table, detail modal, approve/reject actions and rejection modal. | `RequestsScreen` | RN provides filters and actions in list cards; it does not reproduce the table/modal presentation. |
| `studentsdata.html` | Admin UG/PG and year/class selection, department dropdown, student table, details/edit modals, photo controls, SMS opt-out, exports, and bulk actions. | `StudentsScreen` + `StudentFormScreen` | RN supports list/search/edit/delete/photo/SMS/export flows, but does not reproduce all class-selection, table, modal, and bulk-action layouts. |
| `staff-student-data.html` | Staff year tabs/counts, search, paginated student table, photo editor, edit modal, Excel/PDF export. | `StudentsScreen` + `StudentFormScreen` | RN uses a searchable list and lacks the original year-tab/pagination/table presentation. |
| `excelupload.html` | Department/program/year selectors, template link, Excel file input, upload result, and back button. | `ExcelUploadScreen` | RN uploads a picked spreadsheet through the existing API; the template link opens the native guide screen. |
| `excel-upload-template.html` | Static upload guide: required/optional columns, supported headers, sample data, steps, resources, navigation, and common issues. | `ExcelTemplateScreen` | The guide content and navigation are represented in native components; the mobile tables scroll horizontally. |
| `report.html` | Detailed date-range filters, report table/summary, Student List, PDF download, and dashboard navigation; script also contains student/deletion actions. | `ReportsScreen` (detailed) | RN report output uses rows/cards with PDF/Excel sharing for admins only; it does not expose all website actions or match the table layout. |
| `dailyreport.html` | Date and admin program controls, loading/error/empty states, class-summary table, PDF download, and role-aware back/logout. | `ReportsScreen` (`daily: true`) | Admins see class summaries and can export; staff see all five period summaries and absent-student roll numbers without export/share controls. |
| `adminreport.html` | Date-range filters, summary-stat tiles, department/year breakdown cards, Excel download, and admin return. | `ReportsScreen` (`overview: true`) | Reachable from the mobile admin dashboard. The native summary/list layout differs from the original breakdown cards. |
| `deletedata.html` | Department/year selectors, student preview list and counts, delete action, status messages, and admin return. | `DeleteDataScreen` | RN previews aggregate counts rather than the website's student-name preview list. Backend class deletion now also removes period records. |
| `admin-messages.html` | Admin two-column request-conversation list and chat panel, unread indicator, message input, back navigation. | `MessagesScreen` | RN has inbox and conversation states but not the split-pane layout or equivalent unread presentation. |
| `staff-messages.html` | Staff request selector, conversation panel, chat history and message input. | `MessagesScreen` | RN maps the conversation flow but not the website's request-list/chat-panel layout. |
| No existing page | The backend exposes Admin-only staff account list/create/update APIs but the website has no staff-management screen. | `StaffManagementScreen` | Added at the user's request using the existing site-inspired colors and shared mobile components; no original page exists for pixel comparison. |

## Diagnostic pages (not user workflows)

The frontend also contains `system-test.html`, `test-daily-report.html`,
`test-detailed-report.html`, `test-register.html`, `test-student-photos.html`,
`test-student-requests.html`, and `test-token-debug.html`. These are test,
debug, or API-inspection utilities rather than attendance-system screens, so
they are intentionally not mapped to app navigation.

## Backend and model findings

- The API is an Express service mounted under `/api`; authentication uses
  JWTs, with role and staff class-scope middleware. The database is MongoDB
  through Mongoose.
- Existing routes cover auth/class selection/staff account CRUD, students and
  photos, attendance, reports, registration requests, parent notifications,
  and staff messages. The Expo client already uses the corresponding core APIs,
  SecureStore on native, and the existing spreadsheet/report endpoints.
- The original attendance schema stores one `status` (`present` or `absent`)
  for a student/date/class. The mobile implementation leaves that collection
  and API intact and adds a separate `PeriodAttendance` collection, with five
  independently submitted periods, automatic locking on save, and Admin-only
  unlock. Staff may submit during the configured five India-time windows. After
  each save, the mobile app shows the period's absent-student roll numbers and
  names from the persisted period record, including after refreshing or
  reopening it. Period reports use a separate endpoint so the legacy reports
  remain unchanged.
- Admin staff account endpoints exist (`GET/POST /auth/staff`,
  `PUT /auth/staff/:id`), but none of the discovered product HTML pages offers
  staff-account management. There is therefore no existing page design to map
  to a new mobile staff-management screen.
- The website's Excel template is static guidance, not an API. Its content is
  now included as a native screen linked from Excel upload.

## Current validation and completion limits

The Expo TypeScript check and focused period/staff backend tests pass. The full
backend test script currently stops in its existing registration-workflow test
when it attempts an unmocked MongoDB `users.findOne()` call. No Android/iOS
device build or screenshot comparison was run. A reachable API URL and test
credentials are required for end-to-end authentication and workflow testing.
The page-specific visual differences and other gaps in the table remain; exact
visual parity has not been established.
