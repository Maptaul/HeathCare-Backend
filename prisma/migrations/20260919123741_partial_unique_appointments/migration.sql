-- DropIndex
DROP INDEX "appointments_doctorId_patientId_scheduleId_key";

-- DropIndex
DROP INDEX "appointments_scheduleId_serialNumber_joiningTime_key";

-- CreateIndex
CREATE INDEX "appointments_doctorId_patientId_scheduleId_idx" ON "appointments"("doctorId", "patientId", "scheduleId");

-- Re-create the two uniqueness rules as PARTIAL indexes.
-- A CANCELLED appointment must not reserve the patient/schedule pair or the
-- serial number, otherwise a patient can never rebook a schedule they cancelled
-- and the freed serial number can never be handed out again.
-- Prisma cannot express a WHERE clause on @@unique, so these stay raw SQL.
CREATE UNIQUE INDEX "unique_active_appointment"
  ON "appointments" ("doctorId", "patientId", "scheduleId")
  WHERE "status" <> 'CANCELLED';

CREATE UNIQUE INDEX "unique_active_appointment_serial_number"
  ON "appointments" ("scheduleId", "serialNumber", "joiningTime")
  WHERE "status" <> 'CANCELLED';
