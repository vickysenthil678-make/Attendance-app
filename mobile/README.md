# College Attendance System mobile app

Expo + React Native + TypeScript client for the attendance API. The mobile app
does not replace the website. The backend has an additive period-attendance
collection and API; existing once-per-day attendance records and endpoints
remain unchanged.

## Run on Windows and Android

From the project directory containing the root `package.json`, run:

```powershell
npm run dev
```

This starts the existing backend and Expo. The launcher selects the computer's
active network address and uses it for the app's API URL, so Android does not
try to reach the phone's own `localhost`. A non-empty `EXPO_PUBLIC_API_URL`
environment variable overrides the local default, allowing the app to target
the same deployed/shared API as the website. `npm run dev:mobile` is an alias.
To run the Expo web app on Windows with the backend, use `npm run dev:web`.
On Windows, `start.bat` or `run_attendance.ps1` starts the same root command.

For a deployed backend, set its HTTPS API URL before starting:

```powershell
$env:EXPO_PUBLIC_API_URL = "https://your-backend-host/api"
npm run dev
```

For a backend running on this computer, use its LAN address, such as
`http://192.168.1.25:5000/api`, not `localhost` on a physical Android device.
The launcher prints the API URL Expo uses. The API URL is public client
configuration; never put database credentials, JWT secrets, or private API keys
in `EXPO_PUBLIC_*` variables.

Keep the phone and computer on the same Wi-Fi network. Allow Node.js through
Windows Defender Firewall on private networks. If the launcher chooses the
wrong adapter (for example, when a VPN is connected), set the computer's
reachable Wi-Fi IPv4 address before starting:

```powershell
$env:ATTENDANCE_LAN_IP = "192.168.1.25"
npm run dev
```

Do not use `localhost` as the API host for a physical Android device. The
website in the sibling `attendance-normal/front End/` uses the same centralized
backend on port `5000` and selects the API host from the page's hostname. Do not
start `attendance-normal/backend` alongside it. To use the website on Android,
serve that folder over the computer's LAN (for example with VS Code Live Server)
and open the computer's LAN URL on the phone.
For local HTTP development, Android cleartext access is enabled only when the
configured API URL uses `http://`; use HTTPS for production builds.

Keep MongoDB, JWT signing, SMS-provider, and email credentials exclusively in
the backend environment. `EXPO_PUBLIC_*` values are bundled into the app and
are not secret. The mobile app uses the existing JWT endpoints and stores the
token with Expo SecureStore.

## Run and validate

The launcher prints an Expo QR code. Scan it with Expo Go while the phone and computer are on the same Wi-Fi network.

```powershell
npm install
npm run typecheck --prefix mobile
npm run dev
```

For a browser preview with the backend, run `npm run dev:web`. Browser previews
use tab-scoped session storage for the sign-in token; native Android and iOS
continue to use SecureStore. The browser storage option is for local preview
and is not suitable for a public web deployment.

Open the Expo development build on a device on the same reachable network as the API. Android/iOS device runs require the API host firewall, DNS, and TLS configuration to permit the connection.

The existing API has no dedicated PDF download endpoint: the app generates a PDF from the actual report response and shares it through the native share sheet. Excel student upload uses the existing multipart `/students/upload` route. Report spreadsheets are generated from the existing report response.

Daily attendance remains in `Attendance`; period attendance remains in
`PeriodAttendance`. The centralized reporting and retrieval endpoints read
both collections and prefer `PeriodAttendance` when historical period marks
exist in both formats. No attendance documents are migrated or deleted.

## Included workflows

- Admin and staff sign-in; staff class selection; persisted JWT sessions and logout.
- Role-specific dashboards, class-scoped attendance, five-period submission with per-period locking and Admin unlock, plus the separate legacy daily workflow.
- Student CRUD, parent SMS opt-out, and Admin staff-account create/update.
- Excel student import and its upload guide; legacy daily/date-range reports and period attendance reports with PDF/Excel sharing.
- Staff registration requests, admin approval/rejection, staff completion and request-linked messaging.
- Admin notification history/retry, date-range overview reports, and class data preview/deletion.

The existing server remains authoritative for role access, class scope, duplicate prevention, attendance validation, registration approvals, period locks, and SMS. Period records are stored separately from legacy daily attendance. End-to-end verification requires a reachable configured API and test accounts. Android APK/iOS builds require Expo EAS access and platform signing credentials; the `preview` EAS profile is configured to produce an APK.

The configured Android package and iOS bundle identifiers are `edu.thrc.collegeattendance`; replace these with the institution's confirmed unique identifiers before publishing.

With EAS CLI access and the API URL configured as an EAS public environment variable:

```powershell
npx eas-cli build --profile preview --platform android
npm run build:android-apk
```

## Production APK releases

The existing Expo application keeps the Android package
`edu.thrc.collegeattendance`. The production EAS profile now builds an APK
instead of an Android App Bundle. `app.config.js` stores the local version code;
increase both `version` and `android.versionCode` before every
release, so Android can recognize upgrades.

A production APK should use the deployed HTTPS API URL, not the LAN HTTP URL
stored in `mobile/.env`:

```powershell
npx eas-cli login
cd mobile
npx eas-cli build --profile production --platform android
```

EAS asks for signing credentials the first time and stores the Android keystore
in EAS credentials. Never commit the keystore or passwords. Do not add an
Expo project ID to `app.config.js` unless it is obtained from the project's own
Expo account.

After EAS finishes, download the APK locally and validate its package and
signing status with Android SDK `apkanalyzer` or `aapt2`, for example:

```powershell
apksigner verify --print-certs "path\to\app.apk"
aapt dump badging "path\to\app.apk"
```

Publish the downloaded APK to a GitHub Release:

```powershell
$env:GITHUB_TOKEN = "token-created-in-GitHub-with-releases-write-access"
npm run publish:apk -- --ApkPath "C:\path\to\app.apk" --Version "1.0.0" --VersionCode 1
```

Commit and serve `distribution/index.html` and `distribution/release.json`.
The script updates `release.json` with the real direct GitHub asset URL and
APK size. The static page is only enabled after that metadata contains a real
download URL. GitHub Releases keeps previous APK assets available unless an
older release or asset is manually deleted.
