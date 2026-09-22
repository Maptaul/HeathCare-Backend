# PH Healthcare API Documentation

REST API reference for the Healthcare-Backend service — a doctor-appointment platform where patients book consultations, doctors run them, and admins manage the platform.

Base URL (local): `http://localhost:5000`
All endpoints below are mounted under `/api/v1`, e.g. `POST /api/v1/auth/login`.

## Table of contents

- [Response envelope](#response-envelope)
- [Authentication](#authentication)
- [Pagination & filtering conventions](#pagination--filtering-conventions)
- [File uploads](#file-uploads)
- [Errors you'll commonly see](#errors-youll-commonly-see)
- [Auth API](#auth-api) — `/api/v1/auth`
- [User API](#user-api) — `/api/v1/user`
- [Doctor API](#doctor-api) — `/api/v1/doctor`
- [Schedule API](#schedule-api) — `/api/v1/schedule`
- [Appointment API](#appointment-api) — `/api/v1/appointment`
- [Payment API](#payment-api) — `/api/v1/payment`
- [Prescription API](#prescription-api) — `/api/v1/prescription`
- [Analytics API](#analytics-api) — `/api/v1/analytics`

A ready-to-import request collection also exists at [`postman/PH-Healthcare.postman_collection.json`](../postman/PH-Healthcare.postman_collection.json).

## Response envelope

Every endpoint (success or error) returns JSON in this shape:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Human readable message",
  "data": { },
  "meta": { "page": 1, "limit": 10, "total": 42, "totalPages": 5 }
}
```

- `meta` is only present on paginated list endpoints.
- Error responses set `"success": false` and add `"name"` (the error class name). In development (`NODE_ENV=development`) they also include the raw `error` object and `stack`; in production only `message`/`name` for 4xx errors are sent, and 5xx errors are masked as `"Internal Server Error"`.

```json
{
  "success": false,
  "statusCode": 400,
  "name": "AppError",
  "message": "Schedule is not published"
}
```

## Authentication

Auth is JWT-based. `POST /auth/login`, `/auth/verify-email`, `/auth/google`, and `/auth/refresh-token` return `accessToken` and `refreshToken`:

- In the JSON response body (`data.accessToken` / `data.refreshToken`).
- As `httpOnly` cookies (`accessToken`, `refreshToken`).

Send the access token on protected routes as either:

```
Authorization: Bearer <accessToken>
```

or the raw token with no `Bearer ` prefix — `checkAuth` accepts both. An `Authorization` header always takes priority over the `accessToken` cookie if both are present.

Access tokens last `JWT_ACCESS_EXPIRES_IN` (see `.env`); use `POST /auth/refresh-token` (reads the `refreshToken` cookie) to get a new pair without logging in again.

### Roles

Four roles exist, checked per-route via `auth(...roles)`:

| Role | Description |
| --- | --- |
| `PATIENT` | Default role for self-registered users. Books/pays/cancels appointments. |
| `DOCTOR` | Created only via the doctor-application flow, after admin approval. Manages own schedules, appointments, prescriptions. |
| `ADMIN` | Reviews doctor applications, views all appointments/payments/schedules, sees platform analytics. |
| `SUPER_ADMIN` | Same permissions as `ADMIN` everywhere in the current codebase. |

A route with no `auth(...)` middleware is public. A route can also reject with `403 Forbidden` if the caller's role isn't in the allowed list, or if the account `status` is `BLOCKED`.

## Pagination & filtering conventions

List endpoints share a common query-string shape (all optional unless stated otherwise):

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `page` | number | `1` | 1-indexed |
| `limit` | number | `10` | Page size |
| `sortBy` | string | `createdAt` (varies by endpoint) | Any sortable column on the model |
| `sortOrder` | `asc` \| `desc` | `asc` | |
| `searchTerm` | string | – | Case-insensitive partial match, fields vary per endpoint |

Additional filters specific to an endpoint (e.g. `status`, `doctorId`, `specialization`) are documented per endpoint below.

## File uploads

Two endpoints accept `multipart/form-data`: `POST /doctor/apply-as-doctor` and `PATCH /user/profile-image`. Files are buffered in memory (`multer.memoryStorage()`, no size/type limit enforced by the server) and streamed to Cloudinary.

## Errors you'll commonly see

| Status | When |
| --- | --- |
| `400 Bad Request` | Zod validation failure (message is the first issue found), or a business rule rejection (e.g. booking an unpublished schedule) |
| `401 Unauthorized` | Missing/invalid/expired token, or wrong password |
| `403 Forbidden` | Authenticated but wrong role, blocked account, or not the resource owner |
| `404 Not Found` | Resource doesn't exist (or doesn't belong to the caller, in some lookups) |
| `409 Conflict` | Duplicate email/resource on create |
| `500 Internal Server Error` | Unhandled/gateway (e.g. bKash) failure |

---

# Auth API

Base path: `/api/v1/auth`

Patient self-registration is a two-step, OTP-verified flow. No account is created in step 1 — the payload sits in Redis for 5 minutes until the OTP is confirmed.

### POST /register

Start patient registration. Sends a 6-digit OTP to the given email; **no user row is created yet**.

**Auth:** none

**Body**

```json
{
  "name": "Rahim Ali",
  "email": "patient@example.com",
  "password": "Patient@12345",
  "patient": {
    "contactNumber": "+8801700000001"
  }
}
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes | 3–10 characters |
| `email` | string | yes | valid email |
| `password` | string | yes | ≥8 chars, needs upper, lower, digit, and one of `@$!%*?&` |
| `patient.contactNumber` | string | no | |

**Response** `201`

```json
{ "success": true, "statusCode": 201, "message": "Verification OTP sent to email successfully", "data": null }
```

**Errors:** `409` if a user with that email already exists.

### POST /verify-email

Complete patient registration. Creates the `User` + `Patient` rows and logs the patient in.

**Auth:** none

**Body**

```json
{ "email": "patient@example.com", "otp": "482913" }
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `email` | string | yes | |
| `otp` | string | yes | exactly 6 digits |

**Response** `201` — sets `accessToken`/`refreshToken` cookies and returns them in the body:

```json
{
  "success": true,
  "statusCode": 201,
  "message": "email verified successfully",
  "data": {
    "accessToken": "...",
    "refreshToken": "...",
    "user": { "id": "...", "email": "...", "role": "PATIENT", "emailVerified": true },
    "patient": { "id": "...", "name": "Rahim Ali" }
  }
}
```

**Errors:** `400` OTP expired/invalid, or registration data expired (>5 min); `403` if the user is blocked/deleted; `400` if already verified.

### POST /login

**Auth:** none

**Body**

```json
{ "email": "patient@example.com", "password": "Patient@12345" }
```

**Response** `200` — sets cookies and returns tokens:

```json
{ "success": true, "statusCode": 200, "message": "User logged in successfully", "data": { "accessToken": "...", "refreshToken": "..." } }
```

**Errors:** `404` user not found; `403` blocked/deleted; `400` if account was registered via Google (no password set); `401` wrong password.

Note: login does **not** require `emailVerified` to be true — an unverified doctor account, for example, can still authenticate.

### GET /me

Fetch the logged-in user's profile.

**Auth:** `SUPER_ADMIN`, `ADMIN`, `DOCTOR`, `PATIENT` (any authenticated user)

**Response** `200`

```json
{
  "success": true,
  "statusCode": 200,
  "message": "User profile fetched successfully",
  "data": {
    "id": "...", "name": "...", "email": "...", "role": "PATIENT",
    "status": "ACTIVE", "emailVerified": true, "imageUrl": "",
    "patient": { "id": "...", "contactNumber": "..." }
  }
}
```

Only the `patient` relation is included — a doctor account's `doctor` profile is **not** attached to this response (fetch it via the doctor endpoints instead).

### POST /refresh-token

Issue a new access/refresh token pair from a valid refresh token.

**Auth:** none (reads the `refreshToken` httpOnly cookie — not the request body)

**Response** `200` — same shape as `/login`, plus rotates the cookies.

**Errors:** `401` if the `refreshToken` cookie is missing or invalid/expired.

### POST /google

Log in or auto-register via a Google ID token.

**Auth:** none

**Body**

```json
{ "idToken": "<Google ID token from the client SDK>" }
```

**Response** `200` — same shape as `/login`.

**Errors:** `401` invalid Google ID token; `400` if the token has no email.

### POST /forgot-password

Send a password-reset OTP to the given email.

**Auth:** none

**Body**

```json
{ "email": "patient@example.com" }
```

**Response** `200`

```json
{ "success": true, "statusCode": 200, "message": "OTP sent to email : patient@example.com", "data": {} }
```

### POST /reset-password

**Auth:** none

**Body**

```json
{ "email": "patient@example.com", "newPassword": "Patient@54321", "otp": "482913" }
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `email` | string | yes | |
| `newPassword` | string | yes | same complexity rule as registration |
| `otp` | string | yes | exactly 6 digits |

**Response** `200`

```json
{ "success": true, "statusCode": 200, "message": "Password reset successfully", "data": null }
```

### POST /logout

Clears the `accessToken`/`refreshToken` cookies. Does not require a valid token — it always succeeds.

**Auth:** none

**Response** `200`

```json
{ "success": true, "statusCode": 200, "message": "User logged out successfully", "data": null }
```

---

# User API

Base path: `/api/v1/user`

### PATCH /profile-image

Upload/replace the logged-in user's profile photo. Stored on Cloudinary; if the user already had a profile image, the old Cloudinary asset is deleted after the new one is saved.

**Auth:** `SUPER_ADMIN`, `ADMIN`, `DOCTOR`, `PATIENT` (any authenticated user)

**Body:** `multipart/form-data`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `profileImage` | file | yes | any file type/size — not restricted server-side |

**Response** `200` — the full updated user record (password omitted):

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Profile image uploaded successfully",
  "data": {
    "id": "...", "name": "...", "email": "...", "role": "PATIENT",
    "imageUrl": "https://res.cloudinary.com/.../image.jpg",
    "imagePublicId": "..."
  }
}
```

**Errors:** `400` if no file is attached.

---

# Doctor API

Base path: `/api/v1/doctor`

The doctor lifecycle: **apply** (public, creates a `User`+`Doctor` with a random, never-emailed password and `needPasswordChange: true`) → **verify email** (OTP) → **admin approves/rejects**. Since the generated password is never sent to the applicant, the practical way for a doctor to set a real password is `POST /auth/forgot-password` → `POST /auth/reset-password`, then `POST /auth/login` to manage their profile/schedules.

### POST /apply-as-doctor

Apply to become a doctor. Creates the `User` (role `DOCTOR`, random password, `needPasswordChange: true`) and `Doctor` rows immediately, uploads the resume/files to Cloudinary, and emails a 6-digit OTP.

**Auth:** none

**Body:** `multipart/form-data`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `data` | string (JSON) | yes | JSON-encoded object, shape below |
| `resume` | file | no (server expects it but doesn't hard-require it) | single file |
| `additionalFiles` | file[] | no | up to 10 files |

`data` decodes to:

```json
{
  "user": { "name": "Dr. Fatima", "email": "doctor@example.com" },
  "doctor": {
    "address": "House 12, Road 5, Dhanmondi, Dhaka",
    "specialization": "Cardiology",
    "licenseNumber": "BMDC-123456",
    "qualifications": "MBBS, FCPS (Cardiology)",
    "experienceYears": 8,
    "bio": "Consultant cardiologist...",
    "consultationFee": 1200,
    "contactNumber": "+8801700000098"
  }
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `user.name` | yes | min 2 chars |
| `user.email` | yes | valid email |
| `doctor.address` | no | min 5 chars if present |
| `doctor.specialization` | yes | min 2 chars |
| `doctor.licenseNumber` | yes | must be unique |
| `doctor.qualifications` | yes | |
| `doctor.experienceYears` | yes | integer ≥0 |
| `doctor.bio` | no | |
| `doctor.consultationFee` | no | number ≥0 |
| `doctor.contactNumber` | no | min 5 chars if present |

**Response** `200` — the created `User` record including the nested `doctor`.

**Errors:** `409` if a user with that email already exists; `400` if `data` fails validation.

### POST /apply-as-doctor/verify-email

Verify the OTP sent during application. Sets `emailVerified: true` on the doctor's user account (does **not** log the doctor in — verification status is still `PENDING` until an admin approves).

**Auth:** none

**Body**

```json
{ "email": "doctor@example.com", "otp": "482913" }
```

**Response** `200` — the updated `User` (password omitted) including `doctor`.

**Errors:** `404` no such doctor user; `400` already verified / OTP expired / invalid OTP.

### POST /approve-doctor

Approve or reject a pending doctor application. Emails the doctor either way.

**Auth:** `ADMIN`, `SUPER_ADMIN`

**Body**

```json
{ "doctorId": "uuid", "verificationStatus": "APPROVED", "rejectionReason": "" }
```

| Field | Required | Notes |
| --- | --- | --- |
| `doctorId` | yes | |
| `verificationStatus` | yes | `"APPROVED"` or `"REJECTED"` |
| `rejectionReason` | conditionally | **required** when `verificationStatus` is `"REJECTED"` |

**Response** `200` — the updated `Doctor` record.

**Errors:** `404` doctor not found; `403` doctor is soft-deleted; `403` doctor's email isn't verified yet; `400` doctor already reviewed (not `PENDING`); `400` missing rejection reason on reject.

### GET /all-doctors

Admin listing of doctors (any verification status, including soft-deleted if `isDeleted=true` is passed).

**Auth:** `ADMIN`, `SUPER_ADMIN`

**Query params**

| Param | Notes |
| --- | --- |
| `page`, `limit`, `sortBy` (default `createdAt`), `sortOrder` | standard pagination |
| `searchTerm` | matches `name`, `email`, `specialization`, `licenseNumber` (case-insensitive) |
| `specialization` | exact match, case-insensitive |
| `email` | exact match, case-insensitive |
| `licenseNumber` | exact match, case-insensitive |
| `verificationStatus` | `PENDING` \| `APPROVED` \| `REJECTED` |
| `isDeleted` | `"true"` / anything else → `false` |

**Response** `200` — paginated list of full `Doctor` records + `meta`.

### PATCH /update-my-profile

Doctor edits their own profile.

**Auth:** `DOCTOR`

**Body** (all optional)

```json
{
  "address": "House 21, Road 9, Gulshan, Dhaka",
  "bio": "General physician.",
  "consultationFee": 800,
  "contactNumber": "+8801700000098"
}
```

| Field | Notes |
| --- | --- |
| `address` | min 5 chars |
| `bio` | max 1000 chars |
| `consultationFee` | number ≥0 |
| `contactNumber` | min 5 chars |

Note: `specialization`, `licenseNumber`, `qualifications`, `experienceYears`, and `name`/`email` are **not editable** through this endpoint. Sending an empty body (or only unrecognized fields, which Zod strips) returns `400`.

**Response** `200` — the updated `Doctor` record.

**Errors:** `404` doctor not found; `400` no valid fields in body.

### GET /public/available-today

Public listing of doctors who have at least one `PUBLISHED` schedule today with `availableSlots > 0`.

**Auth:** none

**Query params:** `page`, `limit`, `sortBy` (default `name`), `sortOrder`, `searchTerm` (matches `name`/`specialization`), `specialization`.

**Response** `200` — paginated list + `meta`.

### GET /public/all-doctors

Public directory of approved, non-deleted doctors. Only a safe subset of fields is returned.

**Auth:** none

**Query params:** `page`, `limit`, `sortBy` (default `createdAt`), `sortOrder`, `searchTerm` (matches `name`/`specialization`/`qualifications`), `specialization`.

**Response** `200`

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Doctors list retrieved successfully",
  "data": [
    {
      "id": "...", "name": "Dr. Fatima", "specialization": "Cardiology",
      "licenseNumber": "BMDC-123456", "qualifications": "MBBS, FCPS",
      "experienceYears": 8, "bio": "...", "consultationFee": "1200.00",
      "createdAt": "2026-09-01T00:00:00.000Z"
    }
  ],
  "meta": { "page": 1, "limit": 10, "total": 1, "totalPages": 1 }
}
```

### GET /public/:doctorId

Public single-doctor profile with upcoming, bookable schedules attached. **This route is registered last** — keep any new static `/public/*` routes above it.

**Auth:** none

**Path params:** `doctorId`

**Response** `200`

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Doctor profile retrieved successfully",
  "data": {
    "id": "...", "name": "Dr. Fatima", "specialization": "Cardiology",
    "licenseNumber": "BMDC-123456", "qualifications": "MBBS, FCPS",
    "experienceYears": 8, "bio": "...", "consultationFee": "1200.00",
    "createdAt": "...", "isDeleted": false, "verificationStatus": "APPROVED",
    "schedules": [
      { "id": "...", "startDateTime": "...", "endDateTime": "...", "totalSlots": 6, "availableSlots": 4 }
    ]
  }
}
```

`schedules` only includes non-deleted, `PUBLISHED`, future schedules with `availableSlots > 0`, ordered by `startDateTime` ascending.

---

# Schedule API

Base path: `/api/v1/schedule`

A schedule is one time block a doctor opens for bookings on a given day. Rules enforced across create/update:

- **One schedule per doctor per calendar day** (based on `startDateTime`'s date).
- `startDateTime` and `endDateTime` must be on the same day, and start must be before end.
- Slots are carved in fixed **20-minute** chunks: `totalSlots = floor(durationMinutes / 20)`, must be ≥1.
- A schedule that is `PUBLISHED` **and already has at least one booking** (`availableSlots !== totalSlots`) can no longer be updated or deleted.

### POST /create-schedule

**Auth:** `DOCTOR`

**Body**

```json
{
  "startDateTime": "2026-09-25T09:00:00.000Z",
  "endDateTime": "2026-09-25T13:00:00.000Z",
  "meetingLink": "https://meet.google.com/demo-consult-room"
}
```

`totalSlots`/`availableSlots` are computed server-side, not accepted as input. New schedules are created with `status: "DRAFT"`.

**Response** `201` — created schedule including `doctor: { name, email, contactNumber }`.

**Errors:** `404` doctor not found; `409` a schedule already exists that day, or start is after end; `400` block is shorter than 20 minutes.

### GET /my-schedules

The logged-in doctor's own schedules.

**Auth:** `DOCTOR`

**Query params:** `page`, `limit`, `sortBy` (default `createdAt`), `sortOrder`, `status` (`DRAFT` | `PUBLISHED`).

**Response** `200` — paginated schedules, each including `appointments` (with `patient`).

### GET /all-schedules

Admin view across all doctors.

**Auth:** `ADMIN`, `SUPER_ADMIN`

**Query params:** `page`, `limit`, `sortBy` (default `createdAt`), `sortOrder`, `doctorId`, `email` (doctor's email), `status`, `searchTerm` (matches doctor `name`/`email`/`specialization`/`licenseNumber`).

**Response** `200` — paginated schedules + `meta`.

### GET /todays-schedule

Public listing of a specific doctor's schedules for today.

**Auth:** none

**Query params:** `doctorId` **(required)**, `page`, `limit`, `sortBy` (default `createdAt`), `sortOrder`.

**Errors:** `400` if `doctorId` is missing.

### PATCH /update-schedule/:scheduleId

**Auth:** `DOCTOR` (must own the schedule)

**Path params:** `scheduleId`

**Body** (all optional — unset fields keep their current value)

```json
{ "meetingLink": "https://meet.google.com/demo-consult-room-updated" }
```

Changing `startDateTime`/`endDateTime` recomputes `totalSlots`/`availableSlots`, so it re-runs the same same-day/duration/conflict checks as create (excluding the schedule being edited).

**Response** `200` — updated schedule.

**Errors:** `404` not found / not yours; `400` schedule is published with existing bookings; `409` day conflict or start-after-end; `400` too short.

### PATCH /publish-schedule/:scheduleId

Flip a `DRAFT` schedule to `PUBLISHED`, making it bookable by patients.

**Auth:** `DOCTOR` (must own the schedule)

**Response** `200` — updated schedule.

**Errors:** `404` not found / not yours; `400` already published.

### GET /:scheduleId

**Auth:** `DOCTOR`, `ADMIN`, `SUPER_ADMIN`

**Response** `200` — schedule including `doctor` (id, name, email, specialization, userId) and `appointments` (with `patient`).

**Errors:** `404` not found or soft-deleted.

### DELETE /:scheduleId

Soft-deletes the schedule (`isDeleted: true`, `deletedAt` set) — nothing is physically removed.

**Auth:** `DOCTOR` (must own the schedule)

**Response** `200` — the soft-deleted schedule record.

**Errors:** `404` not found / not yours; `400` published with existing bookings.

---

# Appointment API

Base path: `/api/v1/appointment`

Appointments move through `PENDING → CONFIRMED → ONGOING → COMPLETED`, or to `CANCELLED` from `PENDING`/`CONFIRMED`. Payment is via bKash's tokenized checkout; booking creates the appointment (`PENDING`) and a bKash checkout session in the same transaction, and the bKash callback confirms it.

### POST /book-appointment

Book a slot on a published schedule. Creates the `Appointment` (status `PENDING`) and a bKash payment session; does **not** consume a slot or set `joiningTime`/`serialNumber` yet — that happens on payment confirmation.

**Auth:** `PATIENT`

**Body**

```json
{ "scheduleId": "uuid" }
```

**Response** `200`

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Appointment booked successfully",
  "data": { "appointmentId": "uuid", "paymentUrl": "https://sandbox.bkash.com/checkout/..." }
}
```

Redirect the patient to `paymentUrl` to complete payment.

**Business rules / errors:**
- `404` patient/schedule not found.
- `400` schedule not `PUBLISHED`.
- `400` schedule's date isn't today, or its start time has already passed.
- `400` patient already has a non-cancelled appointment for this schedule (message varies by that appointment's status: already booked/confirmed/ongoing/completed).
- `400` no available slots.
- `400` doctor has no consultation fee set.
- `502` bKash token acquisition failed.

### POST /pay-appointment

Re-initiate payment for an appointment still stuck in `PENDING` (e.g. the first bKash session expired).

**Auth:** `PATIENT`

**Body**

```json
{ "appointmentId": "uuid" }
```

**Response** `200`

```json
{ "success": true, "statusCode": 200, "message": "Appointment initiated successfully", "data": { "paymentUrl": "..." } }
```

**Errors:** `404` appointment not found; `400` appointment isn't `PENDING`; `400` no consultation fee set; `502` bKash token failure.

### GET /book-appointment/payment/callback

bKash redirects here after checkout. **Not meant to be called directly by API clients** — it processes the payment result then `302`-redirects the browser to the frontend (`${FRONTEND_URL}/dashboard/my-appointments?status=success|failure|cancel`).

**Auth:** none

**Query params (from bKash):** `paymentID`, `status` (`success` | `failure` | `cancel`).

On `success`, the handler:
1. Executes the payment with bKash (falls back to a status check if bKash reports the payment already executed — handles duplicate callbacks safely).
2. Confirms the appointment (`CONFIRMED`), assigns `serialNumber` and `joiningTime` (`scheduleStart + (serialNumber-1) * 20min`), decrements `schedule.availableSlots`.
3. Marks the `Payment` `PAID`.
4. Emails the patient a confirmation PDF (best-effort — a failure here does not roll back the payment).

A replayed callback on an already-non-`PENDING` appointment just redirects without redoing the booking. A callback for an appointment that was cancelled before payment finished returns `409 Conflict` (needs manual refund).

### POST /cancel-appointment

**Auth:** `PATIENT`, `ADMIN`, `SUPER_ADMIN`

**Body**

```json
{ "appointmentId": "uuid" }
```

**Response** `200`

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Appointment cancelled successfully",
  "data": { "appointment": { "status": "CANCELLED", "..." : "..." }, "payment": { "status": "REFUNDED", "..." : "..." } }
}
```

**Business rules:**
- Cannot cancel an `ONGOING`, `COMPLETED`, or already-`CANCELLED` appointment (`400`).
- If it was `CONFIRMED`, the schedule's `availableSlots` is incremented back by 1.
- **Refund window:** if cancelled more than 1 hour before the schedule's `startDateTime`, a bKash refund is automatically issued and the payment moves to `REFUNDED`. Cancelling within that final hour cancels the appointment but does **not** refund the payment.

**Errors:** `404` appointment not found (or not owned by the calling patient); `502` bKash token failure during refund.

### PATCH /update-status/:appointmentId

Doctor advances an appointment's status during/after a consultation.

**Auth:** `DOCTOR` (must own the appointment)

**Path params:** `appointmentId`

**Body**

```json
{ "status": "ONGOING" }
```

`status` must be `"ONGOING"` or `"COMPLETED"`. Valid transitions: `CONFIRMED → ONGOING` and `ONGOING → COMPLETED` only — any other combination (including skipping a step) is rejected.

**Response** `200` — updated appointment.

**Errors:** `404` doctor/appointment not found; `400` appointment is `COMPLETED`/`CANCELLED`/`PENDING` already, or the requested status doesn't match the required next step.

### GET /my-appointments

The logged-in patient's own appointments.

**Auth:** `PATIENT`

**Query params:** `page`, `limit`, `sortBy` (default `createdAt`), `sortOrder`, `status`.

**Response** `200` — paginated list, each item including `doctor` (id, name, specialization), `schedule`, `payment`.

### GET /doctor-appointments

The logged-in doctor's own appointments.

**Auth:** `DOCTOR`

**Query params:** `page`, `limit`, `sortBy` (default `createdAt`), `sortOrder`, `status`.

**Response** `200` — paginated list, each item including `patient` (id, name, email, contactNumber), `schedule`, `payment`.

### GET /all-appointments

**Auth:** `ADMIN`, `SUPER_ADMIN`

**Query params:** `page`, `limit`, `sortBy` (default `createdAt`), `sortOrder`, `status`, `doctorId`, `patientId`, `doctorEmail`, `patientEmail`.

**Response** `200` — paginated list including `patient`, `doctor`, `schedule`, `payment`.

### GET /:appointmentId

**Auth:** `PATIENT`, `DOCTOR`, `ADMIN`, `SUPER_ADMIN`

**Response** `200` — full appointment including `patient`, `doctor`, `schedule`, `payment`.

**Errors:** `404` not found; `403` a `PATIENT`/`DOCTOR` caller who isn't the owner of this appointment.

---

# Payment API

Base path: `/api/v1/payment`

Read-only endpoints — payments themselves are created/updated as a side effect of the [Appointment API](#appointment-api) (`book-appointment`, `pay-appointment`, the bKash callback, and `cancel-appointment`'s refund logic).

### GET /my-payments

The logged-in patient's own payment history.

**Auth:** `PATIENT`

**Query params:** `page`, `limit`, `sortBy` (default `createdAt`), `sortOrder`.

**Response** `200` — paginated list, each item including `appointment` (with `doctor`: id/name/specialization, and `schedule`).

**Errors:** `404` if the caller has no `Patient` record.

### GET /all-payments

**Auth:** `ADMIN`, `SUPER_ADMIN`

**Query params:** `page`, `limit`, `sortBy` (default `createdAt`), `sortOrder`, `patientEmail` (exact match).

**Response** `200` — paginated list, same shape as `/my-payments`.

### GET /:paymentId

**Auth:** `PATIENT`, `ADMIN`, `SUPER_ADMIN`

**Response** `200`

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Payment retrieved successfully",
  "data": {
    "id": "...", "status": "PAID", "amount": "1200.00", "currency": "BDT",
    "paymentGateway": "bkash", "merchantInvoiceNumber": "...",
    "bkashPaymentId": "...", "bkashTrxId": "...", "paidAt": "...",
    "refundTrxId": null, "refundAmount": null, "refundedAt": null,
    "appointment": {
      "patient": { "id": "...", "name": "...", "email": "...", "userId": "..." },
      "doctor": { "id": "...", "name": "...", "specialization": "..." },
      "schedule": { "..." : "..." }
    }
  }
}
```

**Errors:** `404` not found; `403` a `PATIENT` caller who isn't the appointment's patient.

---

# Prescription API

Base path: `/api/v1/prescription`

There is no `Prescription` model — a prescription is a generated PDF uploaded to Cloudinary, with its URL stored directly on `Appointment.prescriptionUrl`/`prescriptionPublicId`. Exactly one prescription can exist per appointment.

### POST /create-prescription

Doctor writes a prescription for a completed appointment. Generates a PDF, uploads it, emails it to the patient, and stores the URL on the appointment.

**Auth:** `DOCTOR` (must own the appointment)

**Body**

```json
{
  "appointmentId": "uuid",
  "findings": "Patient presents with mild hypertension. Blood pressure 140/90.",
  "medicines": [
    {
      "name": "Amlodipine 5mg",
      "dosage": "1 tablet",
      "duration": "30 days",
      "instructions": "Take once daily in the morning, with or without food."
    }
  ]
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `appointmentId` | yes | |
| `findings` | yes | min 5 chars |
| `medicines` | yes | array, ≥0 items |
| `medicines[].name` | yes | |
| `medicines[].dosage` | yes | |
| `medicines[].duration` | yes | |
| `medicines[].instructions` | no | |

**Response** `200` — the updated `Appointment` (with `prescriptionUrl` set).

**Errors:**
- `404` doctor/appointment not found (or the appointment doesn't belong to this doctor).
- `400` appointment status isn't `COMPLETED`.
- `400` a prescription already exists for this appointment.

### GET /:appointmentId

Fetch the prescription for an appointment (by appointment ID, not a prescription ID).

**Auth:** `PATIENT`, `DOCTOR`, `SUPER_ADMIN`

**Response** `200`

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Prescription fetched successfully",
  "data": {
    "appointment": {
      "id": "...", "status": "COMPLETED",
      "doctor": { "id": "...", "name": "...", "specialization": "..." },
      "patient": { "id": "...", "name": "..." }
    },
    "prescriptionUrl": "https://res.cloudinary.com/.../prescription.pdf"
  }
}
```

**Errors:** `404` appointment not found, or no prescription exists yet for it; `403` a `PATIENT`/`DOCTOR` caller who isn't party to this appointment.

Note: `ADMIN` (non-super) is not authorized on this route — only `SUPER_ADMIN` is, alongside the patient and doctor.

---

# Analytics API

Base path: `/api/v1/analytics`

Read-only, role-scoped dashboard numbers. All amounts are plain numbers (not strings), already summed server-side.

### GET /patient-analytics

**Auth:** `PATIENT`

**Response** `200`

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Patient analytics fetched successfully",
  "data": {
    "totalAppointments": 12,
    "upcomingAppointments": 2,
    "completedAppointments": 8,
    "pendingAppointments": 1,
    "cancelledAppointments": 1,
    "totalAmountSpent": 9600,
    "totalRefunded": 800
  }
}
```

| Field | Meaning |
| --- | --- |
| `upcomingAppointments` | count with status `CONFIRMED` (paid, not yet started) |
| `totalAmountSpent` | sum of `PAID` payments for this patient |
| `totalRefunded` | sum of `REFUNDED` payments for this patient |

**Errors:** `404` if the caller has no `Patient` record.

### GET /doctor-analytics

**Auth:** `DOCTOR`

**Response** `200`

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Doctor analytics fetched successfully",
  "data": {
    "totalSchedules": 20,
    "publishedSchedules": 15,
    "totalAppointments": 40,
    "upcomingAppointments": 3,
    "ongoingAppointments": 1,
    "completedAppointments": 30,
    "pendingAppointments": 2,
    "cancelledAppointments": 4,
    "totalDoctorRefunds": 1200,
    "totalDoctorEarnings": 22800
  }
}
```

| Field | Meaning |
| --- | --- |
| `upcomingAppointments` | count with status `CONFIRMED` |
| `totalDoctorEarnings` | sum of `PAID` payments for this doctor's appointments, **minus** `totalDoctorRefunds` |
| `totalDoctorRefunds` | sum of `REFUNDED` payments for this doctor's appointments |

**Errors:** `404` if the caller has no `Doctor` record.

### GET /admin-analytics

**Auth:** `ADMIN`, `SUPER_ADMIN`

**Response** `200`

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Admin analytics fetched successfully",
  "data": {
    "totalDoctors": 25,
    "pendingDoctorsApplications": 3,
    "ApprovedDoctorsApplications": 20,
    "RejectedDoctorsApplications": 2,
    "totalPatients": 500,
    "totalAppointments": 1200,
    "completedAppointments": 900,
    "pendingAppointments": 50,
    "cancelledAppointments": 100,
    "totalRefunded": 15000,
    "totalRevenue": 585000
  }
}
```

Platform-wide, not scoped to any one user. `totalDoctors`/`totalPatients` exclude soft-deleted rows. `totalRevenue` is the sum of all `PAID` payments minus `totalRefunded`. Note the inconsistent casing on `ApprovedDoctorsApplications`/`RejectedDoctorsApplications` (capital first letter) versus `pendingDoctorsApplications` — that's the literal field name returned by the API, not a typo in this doc.
