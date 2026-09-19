import httpStatus from "http-status";
import {
  AppointmentStatus,
  DoctorVerificationStatus,
  PaymentStatus,
  ScheduleStatus,
} from "../../../generated/prisma/enums";
import { prisma } from "../../lib/prisma";
import { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/appError";

const getAdminAnalytics = async () => {
  // total doctors
  const totalDoctors = await prisma.user.count({
    where: {
      isDeleted: false,
    },
  });

  const pendingDoctorsApplications = await prisma.user.count({
    where: {
      isDeleted: false,
      verificationStatus: DoctorVerificationStatus.PENDING,
    },
  });
  const ApprovedDoctorsApplications = await prisma.user.count({
    where: {
      isDeleted: false,
      verificationStatus: DoctorVerificationStatus.APPROVED,
    },
  });

  const RejectedDoctorsApplications = await prisma.user.count({
    where: {
      isDeleted: false,
      verificationStatus: DoctorVerificationStatus.REJECTED,
    },
  });

  const totalPatients = await prisma.user.count({
    where: {
      isDeleted: false,
    },
  });
  const totalAppointments = await prisma.appointment.count({});

  const completedAppointments = await prisma.appointment.count({
    where: {
      status: AppointmentStatus.COMPLETED,
    },
  });

  const pendingAppointments = await prisma.appointment.count({
    where: {
      status: AppointmentStatus.PENDING,
    },
  });

  const cancelledAppointments = await prisma.appointment.count({
    where: {
      status: AppointmentStatus.CANCELLED,
    },
  });

  const totalRefundsResult = await prisma.payment.aggregate({
    where: {
      status: PaymentStatus.REFUNDED,
    },
    _sum: {
      amount: true,
    },
  });

  const totalRefunded = totalRefundsResult._sum.amount?.toNumber() || 0;

  const totalRevenueResult = await prisma.payment.aggregate({
    where: {
      status: PaymentStatus.PAID,
    },
    _sum: {
      amount: true,
    },
  });

  const totalRevenue =
    (totalRevenueResult._sum.amount?.toNumber() || 0) - totalRefunded;

  return {
    totalDoctors,
    pendingDoctorsApplications,
    ApprovedDoctorsApplications,
    RejectedDoctorsApplications,
    totalPatients,
    totalAppointments,
    completedAppointments,
    pendingAppointments,
    cancelledAppointments,
    totalRefunded,
    totalRevenue,
  };
};
const getPatientAnalytics = async (user: RequestUser) => {
  const patient = await prisma.user.findUnique({
    where: { id: user.userId },
  });

  if (!patient) {
    throw new AppError(httpStatus.NOT_FOUND, "Patient not found");
  }

  const totalAppointments = await prisma.appointment.count({
    where: {
      patientId: user.userId,
    },
  });

  const upcomingAppointments = await prisma.appointment.count({
    where: {
      patientId: user.userId,
      status: AppointmentStatus.CONFIRMED,
    },
  });

  const completedAppointments = await prisma.appointment.count({
    where: {
      patientId: patient.id,
      status: AppointmentStatus.COMPLETED,
    },
  });

  const pendingAppointments = await prisma.appointment.count({
    where: {
      patientId: patient.id,
      status: AppointmentStatus.PENDING,
    },
  });

  const cancelledAppointments = await prisma.appointment.count({
    where: {
      patientId: patient.id,
      status: AppointmentStatus.CANCELLED,
    },
  });

  const totalSpentResult = await prisma.payment.aggregate({
    where: {
      appointment: {
        patientId: patient.id,
      },
      status: PaymentStatus.PAID,
    },
    _sum: {
      amount: true,
    },
  });

  const totalAmountSpent = totalSpentResult._sum.amount?.toNumber() || 0;

  const totalRefundsResult = await prisma.payment.aggregate({
    where: {
      appointment: {
        patientId: patient.id,
      },
      status: PaymentStatus.REFUNDED,
    },
    _sum: {
      amount: true,
    },
  });

  const totalRefunded = totalRefundsResult._sum.amount?.toNumber() || 0;

  return {
    totalAppointments,
    upcomingAppointments,
    completedAppointments,
    pendingAppointments,
    cancelledAppointments,
    totalAmountSpent,
    totalRefunded,
  };
};
const getDoctorAnalytics = async (user: RequestUser) => {
  const doctor = await prisma.user.findUnique({
    where: { id: user.userId },
  });

  if (!doctor) {
    throw new AppError(httpStatus.NOT_FOUND, "Doctor not found");
  }

  const totalSchedules = await prisma.schedule.count({
    where: {
      doctorId: user.userId,
    },
  });

  const publishedSchedules = await prisma.schedule.count({
    where: {
      doctorId: user.userId,
      isPublished: true,
      status: ScheduleStatus.PUBLISHED,
    },
  });

  const totalAppointments = await prisma.appointment.count({
    where: {
      doctorId: user.userId,
    },
  });

  const upcomingAppointments = await prisma.appointment.count({
    where: {
      doctorId: user.userId,
      status: AppointmentStatus.CONFIRMED,
    },
  });

  const ongoingAppointments = await prisma.appointment.count({
    where: {
      doctorId: user.userId,
      status: AppointmentStatus.ONGOING,
    },
  });

  const completedAppointments = await prisma.appointment.count({
    where: {
      status: AppointmentStatus.COMPLETED,
    },
  });

  const pendingAppointments = await prisma.appointment.count({
    where: {
      status: AppointmentStatus.PENDING,
    },
  });

  const cancelledAppointments = await prisma.appointment.count({
    where: {
      status: AppointmentStatus.CANCELLED,
    },
  });

  const totalRefundsResult = await prisma.payment.aggregate({
    where: {
      appointment: {
        doctorId: user.userId,
      },
      status: PaymentStatus.REFUNDED,
    },
    _sum: {
      amount: true,
    },
  });

  const totalDoctorRefunds = totalRefundsResult._sum.amount?.toNumber() || 0;

  const totalDoctorEarningsResult = await prisma.payment.aggregate({
    where: {
      appointment: {
        doctorId: user.userId,
      },
      status: PaymentStatus.PAID,
    },
    _sum: {
      amount: true,
    },
  });

  const totalDoctorEarnings =
    (totalDoctorEarningsResult._sum.amount?.toNumber() || 0) -
    totalDoctorRefunds;

  return {
    totalSchedules,
    publishedSchedules,
    totalAppointments,
    upcomingAppointments,
    ongoingAppointments,
    completedAppointments,
    pendingAppointments,
    cancelledAppointments,
    totalDoctorRefunds,
    totalDoctorEarnings,
  };
};

export const AnalyticsService = {
  getAdminAnalytics,
  getPatientAnalytics,
  getDoctorAnalytics,
};
