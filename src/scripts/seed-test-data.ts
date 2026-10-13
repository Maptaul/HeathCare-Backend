/**
 * Seeds test data for manual testing of the whole app.
 *   pnpm seed:test          -> insert (aborts if seed data already exists)
 *   pnpm seed:test --reset  -> delete previous seed data, then insert fresh
 *   pnpm seed:test --doctor someone@mail.com
 *                           -> add schedules + appointments for an existing,
 *                              approved doctor (needs the base seed patients)
 *
 * Only touches users whose email ends with SEED_DOMAIN (deleting them cascades
 * to doctors, patients, schedules, appointments and payments) and schedules
 * whose meetingLink starts with SEED_LINK.
 */
import bcrypt from "bcryptjs";
import { addDays, addMinutes, startOfDay, subDays } from "date-fns";
import {
  AppointmentStatus,
  DoctorVerificationStatus,
  PaymentStatus,
  Role,
  ScheduleStatus,
  UserStatus,
} from "../generated/prisma/enums.js";
import config from "../app/config/index.js";
import { prisma } from "../app/lib/prisma.js";

const SEED_DOMAIN = "@seed.test";
const SEED_PASSWORD = "Test@1234";
const COUNT = 20;
const SEED_LINK = "https://meet.google.com/seed-";
const SLOT_MINUTES = 20; // must match schedule.service MINUTES_ALLOCATED_PER_SLOT

const SPECIALIZATIONS = [
  "Cardiology",
  "Dermatology",
  "Neurology",
  "Pediatrics",
  "Orthopedics",
  "Psychiatry",
  "Gynecology",
  "ENT",
  "Ophthalmology",
  "General Medicine",
];
const FIRST_NAMES = [
  "Rahim", "Karim", "Nusrat", "Farhana", "Tanvir", "Sadia", "Imran", "Mithila",
  "Arif", "Jannat", "Rakib", "Sumaiya", "Hasan", "Tasnim", "Shakil", "Anika",
  "Mahin", "Lamia", "Fahim", "Riya",
];
const LAST_NAMES = ["Ahmed", "Hossain", "Islam", "Rahman", "Chowdhury"];
const CITIES = ["Dhaka", "Chattogram", "Sylhet", "Rajshahi", "Khulna"];

const nameAt = (i: number) =>
  `${FIRST_NAMES[i % FIRST_NAMES.length]} ${LAST_NAMES[i % LAST_NAMES.length]}`;
const at = (day: Date, hour: number) => addMinutes(startOfDay(day), hour * 60);
const slotsBetween = (start: Date, end: Date) =>
  Math.floor((end.getTime() - start.getTime()) / 60000 / SLOT_MINUTES);

// 14 approved, 3 pending (one with unverified email), 3 rejected
const doctorStatusAt = (i: number) =>
  i < 14
    ? DoctorVerificationStatus.APPROVED
    : i < 17
      ? DoctorVerificationStatus.PENDING
      : DoctorVerificationStatus.REJECTED;

const APPOINTMENT_STATUS_CYCLE = [
  AppointmentStatus.PENDING,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.COMPLETED,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.CANCELLED,
  AppointmentStatus.ONGOING,
];
const paymentStatusFor = (status: AppointmentStatus, i: number) => {
  if (status === AppointmentStatus.PENDING)
    return i % 2 ? PaymentStatus.UNPAID : PaymentStatus.FAILED;
  if (status === AppointmentStatus.CANCELLED)
    return i % 2 ? PaymentStatus.REFUNDED : PaymentStatus.CANCELLED;
  return PaymentStatus.PAID;
};
const isSlotTaken = (status: AppointmentStatus) =>
  status !== AppointmentStatus.PENDING &&
  status !== AppointmentStatus.CANCELLED;

const seedDoctors = async (password: string) => {
  const doctors = [];
  for (let i = 0; i < COUNT; i++) {
    const status = doctorStatusAt(i);
    const email = `doctor${i + 1}${SEED_DOMAIN}`;
    const name = `Dr. ${nameAt(i)}`;
    const user = await prisma.user.create({
      data: {
        name,
        email,
        // pending doctors have no password yet, same as the real apply flow
        password: status === DoctorVerificationStatus.PENDING ? null : password,
        role: Role.DOCTOR,
        emailVerified: i !== 16,
        doctor: {
          create: {
            name,
            email,
            address: `${10 + i} Road, ${CITIES[i % CITIES.length]}`,
            specialization: SPECIALIZATIONS[i % SPECIALIZATIONS.length],
            licenseNumber: `SEED-LIC-${String(i + 1).padStart(4, "0")}`,
            qualifications: i % 3 ? "MBBS, FCPS" : "MBBS",
            experienceYears: 2 + (i % 15),
            bio: `Experienced ${SPECIALIZATIONS[i % SPECIALIZATIONS.length]} specialist.`,
            consultationFee: 500 + i * 50,
            contactNumber: `0171${String(1000000 + i).slice(1)}`,
            verificationStatus: status,
            rejectionReason:
              status === DoctorVerificationStatus.REJECTED
                ? "License number could not be verified"
                : null,
            reviewedAt:
              status === DoctorVerificationStatus.PENDING ? null : new Date(),
          },
        },
      },
      include: { doctor: true },
    });
    doctors.push(user.doctor!);
  }
  return doctors;
};

const seedPatients = async (password: string) => {
  const patients = [];
  for (let i = 0; i < COUNT; i++) {
    const email = `patient${i + 1}${SEED_DOMAIN}`;
    const name = nameAt(i + 7);
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password,
        role: Role.PATIENT,
        emailVerified: true,
        status: i === COUNT - 1 ? UserStatus.BLOCKED : UserStatus.ACTIVE,
        patient: {
          create: {
            name,
            email,
            contactNumber: `0181${String(1000000 + i).slice(1)}`,
            address: CITIES[i % CITIES.length],
          },
        },
      },
      include: { patient: true },
    });
    patients.push(user.patient!);
  }
  return patients;
};

// Approved doctors get: yesterday (published), today (published, open until
// late so "available today" works), tomorrow (published or draft).
const seedSchedules = async (doctorIds: string[]) => {
  const now = new Date();
  const days = [
    { day: subDays(now, 1), from: 9, to: 13, status: () => ScheduleStatus.PUBLISHED },
    { day: now, from: 8, to: 23, status: () => ScheduleStatus.PUBLISHED },
    {
      day: addDays(now, 1),
      from: 10,
      to: 14,
      status: (i: number) => (i % 2 ? ScheduleStatus.DRAFT : ScheduleStatus.PUBLISHED),
    },
  ];
  const schedules = [];
  for (const [i, doctorId] of doctorIds.entries()) {
    for (const { day, from, to, status } of days) {
      const startDateTime = at(day, from);
      const endDateTime = at(day, to);
      const totalSlots = slotsBetween(startDateTime, endDateTime);
      schedules.push(
        await prisma.schedule.create({
          data: {
            doctorId,
            startDateTime,
            endDateTime,
            totalSlots,
            availableSlots: totalSlots,
            meetingLink: `${SEED_LINK}${i + 1}-${from}`,
            status: status(i),
          },
          include: { doctor: true },
        }),
      );
    }
  }
  return schedules;
};

const seedAppointments = async (
  schedules: Awaited<ReturnType<typeof seedSchedules>>,
  patientIds: string[],
) => {
  const bookable = schedules.filter((s) => s.status === ScheduleStatus.PUBLISHED);
  const booked = new Map<string, number>();

  for (let i = 0; i < COUNT; i++) {
    const schedule = bookable[i % bookable.length];
    const status = APPOINTMENT_STATUS_CYCLE[i % APPOINTMENT_STATUS_CYCLE.length];
    const takesSlot = isSlotTaken(status);
    const serialNumber = takesSlot ? (booked.get(schedule.id) ?? 0) + 1 : null;
    if (serialNumber) booked.set(schedule.id, serialNumber);

    const appointment = await prisma.appointment.create({
      data: {
        status,
        patientId: patientIds[i % (patientIds.length - 1)], // skip blocked patient
        doctorId: schedule.doctorId,
        scheduleId: schedule.id,
        serialNumber,
        joiningTime: serialNumber
          ? addMinutes(schedule.startDateTime, (serialNumber - 1) * SLOT_MINUTES)
          : null,
      },
    });

    const paymentStatus = paymentStatusFor(status, i);
    const isPaid =
      paymentStatus === PaymentStatus.PAID ||
      paymentStatus === PaymentStatus.REFUNDED;
    const amount = schedule.doctor.consultationFee ?? 500;
    await prisma.payment.create({
      data: {
        appointmentId: appointment.id,
        merchantInvoiceNumber: appointment.id,
        amount,
        status: paymentStatus,
        bkashPaymentId: isPaid ? `SEED-PAY-${appointment.id}` : null,
        bkashTrxId: isPaid ? `SEEDTRX-${appointment.id.slice(0, 8)}` : null,
        paidAt: isPaid ? new Date().toISOString() : null,
        ...(paymentStatus === PaymentStatus.REFUNDED
          ? {
              refundTrxId: `SEEDREF-${appointment.id.slice(0, 8)}`,
              refundAmount: amount,
              refundReason: "Seed: cancelled by patient",
              refundedAt: new Date().toISOString(),
            }
          : {}),
      },
    });
  }

  for (const [scheduleId, count] of booked) {
    await prisma.schedule.update({
      where: { id: scheduleId },
      data: { availableSlots: { decrement: count } },
    });
  }
};

// Fills every other day (even offsets from -6) that the doctor has no
// schedule on yet. The app allows one schedule per doctor per day, so the odd
// days stay free for testing "Create Schedule" by hand.
const seedForDoctor = async (email: string) => {
  const doctor = await prisma.doctor.findUnique({
    where: { email },
    include: { schedules: { where: { isDeleted: false } } },
  });
  if (!doctor || doctor.verificationStatus !== DoctorVerificationStatus.APPROVED) {
    throw new Error(`${email} is not an approved doctor`);
  }

  const patients = await prisma.patient.findMany({
    where: { email: { endsWith: SEED_DOMAIN } },
    orderBy: { email: "asc" },
  });
  if (patients.length < 2) {
    throw new Error("Seed patients missing, run `pnpm seed:test` first");
  }

  const takenDays = new Set(
    doctor.schedules.map((s) => startOfDay(s.startDateTime).getTime()),
  );
  const now = new Date();
  const schedules = [];
  for (let offset = -6; offset <= 40 && schedules.length < COUNT; offset += 2) {
    const day = addDays(now, offset);
    if (takenDays.has(startOfDay(day).getTime())) continue;

    const [from, to] = offset === 0 ? [8, 23] : offset < 0 ? [9, 13] : [10, 14];
    const startDateTime = at(day, from);
    const endDateTime = at(day, to);
    const totalSlots = slotsBetween(startDateTime, endDateTime);
    schedules.push(
      await prisma.schedule.create({
        data: {
          doctorId: doctor.id,
          startDateTime,
          endDateTime,
          totalSlots,
          availableSlots: totalSlots,
          meetingLink: `${SEED_LINK}tester-${offset}`,
          status:
            offset > 0 && offset % 6 === 0
              ? ScheduleStatus.DRAFT
              : ScheduleStatus.PUBLISHED,
        },
        include: { doctor: true },
      }),
    );
  }

  await seedAppointments(schedules, patients.map((p) => p.id));
  console.log(
    `Added ${schedules.length} schedules and ${COUNT} appointments + payments for ${email}.`,
  );
};

const main = async () => {
  const seedUsers = { email: { endsWith: SEED_DOMAIN } };

  const doctorFlag = process.argv.indexOf("--doctor");
  if (doctorFlag !== -1) {
    const email = process.argv[doctorFlag + 1]?.trim().toLowerCase();
    if (!email) throw new Error("Usage: --doctor <email>");
    return seedForDoctor(email);
  }

  if (process.argv.includes("--reset")) {
    const { count } = await prisma.user.deleteMany({ where: seedUsers });
    const { count: links } = await prisma.schedule.deleteMany({
      where: { meetingLink: { startsWith: SEED_LINK } },
    });
    console.log(`Removed ${count} seed users and ${links} seed schedules.`);
  } else if (await prisma.user.count({ where: seedUsers })) {
    console.log("Seed data already exists. Run with --reset to recreate it.");
    return;
  }

  const password = await bcrypt.hash(SEED_PASSWORD, Number(config.bcrypt_salt_rounds));
  const doctors = await seedDoctors(password);
  const patients = await seedPatients(password);
  const approvedIds = doctors
    .filter((d) => d.verificationStatus === DoctorVerificationStatus.APPROVED)
    .map((d) => d.id);
  const schedules = await seedSchedules(approvedIds);
  await seedAppointments(schedules, patients.map((p) => p.id));

  console.log(
    `Seeded ${doctors.length} doctors, ${patients.length} patients, ` +
      `${schedules.length} schedules, ${COUNT} appointments + payments.\n` +
      `Login: doctor1${SEED_DOMAIN} / patient1${SEED_DOMAIN}, password ${SEED_PASSWORD}`,
  );
};

main()
  .catch((error) => {
    console.error("Seeding failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
