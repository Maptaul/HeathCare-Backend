import { addMinutes, isBefore, isSameDay, subHours } from "date-fns";
import ejs from "ejs";
import httpStatus from "http-status";
import path from "path";
import {
  AppointmentStatus,
  PaymentStatus,
  Role,
  ScheduleStatus,
} from "../../../generated/prisma/enums.js";
import { AppointmentWhereInput } from "../../../generated/prisma/models.js";
import config from "../../config/index.js";
import { IQuery } from "../../interfaces/index.js";
import { getBkashIdToken, getBkashPaymentStatus } from "../../lib/bkash.js";
import { transporter } from "../../lib/nodemailer.js";
import { prisma } from "../../lib/prisma.js";
import { RequestUser } from "../../middleware/checkAuth.js";
import { AppError } from "../../utils/appError.js";
import {
  IBookAppointmentPayload,
  ICancelAppointmentPayload,
  IPayAppointmentPayload,
  IUpdateAppointmentStatusPayload,
} from "./appointment.interface.js";
import { buildAppointmentConfirmationPdf } from "./appointment.pdf.js";

const bookAppointment = async (
  payload: IBookAppointmentPayload,
  user: RequestUser,
) => {
  const transactionResult = await prisma.$transaction(async (tx) => {
    // business logic for booking an appointment would go here
    const patient = await prisma.patient.findUnique({
      where: {
        userId: user.userId,
      },
    });
    if (!patient) {
      throw new AppError(
        httpStatus.NOT_FOUND,
        "Patient not found for the user",
        "",
      );
    }

    const schedule = await prisma.schedule.findUnique({
      where: { id: payload.scheduleId },
      include: { doctor: true },
    });
    if (!schedule || schedule.isDeleted) {
      throw new AppError(httpStatus.NOT_FOUND, "Schedule not found", "");
    }

    if (schedule.status !== ScheduleStatus.PUBLISHED) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Schedule is not published",
        "",
      );
    }

    const now = new Date();
    if (!isSameDay(now, schedule.startDateTime)) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Cannot book an appointment for a schedule that is not on the same day",
        "",
      );
    }

    if (!isBefore(now, schedule.startDateTime)) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Cannot book an appointment for a schedule that has already started",
        "",
      );
    }
    // if (isAfter(now, schedule.startDateTime)) {
    //   throw new AppError(
    //     httpStatus.BAD_REQUEST,
    //     "Cannot book an appointment for a schedule that has already started",
    //     "",
    //   );
    // }

    const existingAppointment = await tx.appointment.findFirst({
      where: {
        scheduleId: payload.scheduleId,
        patientId: patient.id,
        status: {
          not: AppointmentStatus.CANCELLED,
        },
      },
    });

    if (existingAppointment?.status === AppointmentStatus.PENDING) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "You have already booked an appointment for this schedule",
        "",
      );
    }
    if (existingAppointment?.status === AppointmentStatus.CONFIRMED) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "You have already booked an appointment for this schedule and it is confirmed",
        "",
      );
    }
    if (existingAppointment?.status === AppointmentStatus.ONGOING) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "You have already booked an appointment for this schedule and it is ongoing",
        "",
      );
    }
    if (existingAppointment?.status === AppointmentStatus.COMPLETED) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "You have already booked an appointment for this schedule and it is completed",
        "",
      );
    }

    if (schedule.availableSlots === 0) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "No available slots for this schedule",
        "",
      );
    }

    if (!schedule.doctor.consultationFee) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Doctor's consultation fee is not set",
        "",
      );
    }

    const amount = schedule.doctor.consultationFee.toString();

    const appointment = await tx.appointment.create({
      data: {
        status: AppointmentStatus.PENDING,
        patientId: patient.id,
        doctorId: schedule.doctorId,
        scheduleId: schedule.id,
      },
    });

    const bkashIdToken = await getBkashIdToken();
    if (!bkashIdToken) {
      throw new AppError(
        httpStatus.BAD_GATEWAY,
        "Failed to get bkash id token",
        "",
      );
    }

    const bkashCreatePaymentResponse = await fetch(
      `${config.bkash_base_url}/tokenized/checkout/create`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          authorization: bkashIdToken,
          "x-app-key": config.bkash_app_key,
        },
        body: JSON.stringify({
          agreementID: "AGREEMENT_ID", // Replace with actual agreement ID
          mode: "0011", // Replace with actual mode (e.g., "0011" for sandbox, "0010" for live)
          // payerReference: "01723888888", // Replace with actual payer reference (e.g., phone number)
          payerReference: user.email, // Replace with actual payer reference (e.g., phone number)
          callbackURL: `${config.bkash_callback_url}/appointment/book-appointment/payment/callback`, // Replace with actual callback URL
          merchantAssociationInfo: "MI05MID54RF09123456One", // Replace with actual merchant association info
          amount: amount, // Replace with actual amount (e.g., "500" for 500 BDT)
          currency: "BDT", // Replace with actual currency (e.g., "BDT" for Bangladeshi Taka)
          intent: "sale", // Replace with actual intent (e.g., "authorization" or "sale")
          // merchantInvoiceNumber: "Inv0124", // Replace with actual merchant invoice number
          merchantInvoiceNumber: appointment.id,
        }),
      },
    );

    const bkashCreatePaymentResult = await bkashCreatePaymentResponse.json();

    // payment model crete

    await tx.payment.create({
      data: {
        merchantInvoiceNumber: bkashCreatePaymentResult.merchantInvoiceNumber,
        appointmentId: appointment.id,
        amount: amount,
        gatewayResponse: bkashCreatePaymentResult,
        bkashPaymentId: bkashCreatePaymentResult.paymentID,
        payerReference: user.email,
      },
    });

    return {
      appointmentId: appointment.id,
      paymentUrl: bkashCreatePaymentResult.bkashURL,
    }; // Return the result of the bKash payment creation
  });

  return transactionResult; // Return the result of the transaction
};

const payAppointment = async (
  payload: IPayAppointmentPayload,
  user: RequestUser,
) => {
  const appointmentId = payload.appointmentId;
  const existingAppointment = await prisma.appointment.findUnique({
    where: {
      id: appointmentId,
    },
    include: {
      schedule: {
        include: {
          doctor: true,
        },
      },
    },
  });
  if (!existingAppointment) {
    throw new AppError(httpStatus.NOT_FOUND, "Appointment not found", "");
  }
  if (existingAppointment.status !== "PENDING") {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "appointments is not in pending state, cannot be paid",
      "",
    );
  }
  // if (
  //   existingAppointment.status === "CANCELLED" ||
  //   existingAppointment.status === "ONGOING" ||
  //   existingAppointment.status === "COMPLETED"
  // ) {
  //   const appointmentStatus = existingAppointment.status;
  //   throw new Error(
  //     `Appointment cannot be paid as it is ${appointmentStatus.toLowerCase}`,
  //   );
  // }

  if (!existingAppointment.schedule.doctor.consultationFee) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Doctor's consultation fee is not set",
      "",
    );
  }

  const amount = existingAppointment.schedule.doctor.consultationFee.toString();
  const bkashIdToken = await getBkashIdToken();
  if (!bkashIdToken) {
    throw new AppError(
      httpStatus.BAD_GATEWAY,
      "Failed to get bkash id token",
      "",
    );
  }

  const bkashCreatePaymentResponse = await fetch(
    `${config.bkash_base_url}/tokenized/checkout/create`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        authorization: bkashIdToken,
        "x-app-key": config.bkash_app_key,
      },
      body: JSON.stringify({
        agreementID: "AGREEMENT_ID", // Replace with actual agreement ID
        mode: "0011", // Replace with actual mode (e.g., "0011" for sandbox, "0010" for live)
        // payerReference: "01723888888", // Replace with actual payer reference (e.g., phone number)
        payerReference: user.email, // Replace with actual payer reference (e.g., phone number)
        callbackURL: `${config.bkash_callback_url}/appointment/book-appointment/payment/callback`, // Replace with actual callback URL
        merchantAssociationInfo: "MI05MID54RF09123456One", // Replace with actual merchant association info
        amount: amount, // Replace with actual amount (e.g., "500" for 500 BDT)
        currency: "BDT", // Replace with actual currency (e.g., "BDT" for Bangladeshi Taka)
        intent: "sale", // Replace with actual intent (e.g., "authorization" or "sale")
        // merchantInvoiceNumber: "Inv0124", // Replace with actual merchant invoice number
        merchantInvoiceNumber: existingAppointment.id,
      }),
    },
  );

  const bkashCreatePaymentResult = await bkashCreatePaymentResponse.json();

  await prisma.payment.update({
    where: {
      appointmentId: existingAppointment.id,
    },
    data: {
      merchantInvoiceNumber: bkashCreatePaymentResult.merchantInvoiceNumber,
      gatewayResponse: bkashCreatePaymentResult,
      bkashPaymentId: bkashCreatePaymentResult.paymentID,
    },
  });
  return {
    paymentUrl: bkashCreatePaymentResult.bkashURL,
  };
};

const BKASH_SUCCESS_CODE = "0000";

const bookAppointmentCallback = async (query: Record<string, any>) => {
  console.log("CALLBACK QUERY:", query);
  console.log("PAYMENT ID:", query.paymentID);
  console.log("STATUS:", query.status);

  const transactionResult = await prisma.$transaction(async (tx) => {
    const paymentId = query.paymentID;

    if (!paymentId) {
      throw new AppError(httpStatus.BAD_REQUEST, "Payment ID is required", "");
    }
    const status = query.status;
    if (!status) {
      throw new AppError(httpStatus.BAD_REQUEST, "Status is required", "");
    }

    const bkashIdToken = await getBkashIdToken();
    if (!bkashIdToken) {
      throw new AppError(
        httpStatus.BAD_GATEWAY,
        "Failed to get bkash id token",
        "",
      );
    }
    const executePaymentResponse = await fetch(
      `${config.bkash_base_url}/tokenized/checkout/execute`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          accept: "application/json",
          authorization: bkashIdToken,
          "x-app-key": config.bkash_app_key,
        },
        body: JSON.stringify({
          paymentID: paymentId,
        }),
      },
    );

    let executePaymentResult = await executePaymentResponse.json();
    if (status === "success") {
      // A replayed callback cannot execute the same payment twice, so fall back
      // to bKash's own record rather than walking on with undefined ids.
      if (executePaymentResult?.statusCode !== BKASH_SUCCESS_CODE) {
        executePaymentResult = await getBkashPaymentStatus(
          paymentId,
          bkashIdToken,
        );
      }

      if (
        executePaymentResult?.statusCode !== BKASH_SUCCESS_CODE ||
        executePaymentResult?.transactionStatus !== "Completed"
      ) {
        throw new AppError(
          httpStatus.BAD_GATEWAY,
          `bKash payment was not completed: ${
            executePaymentResult?.statusMessage ||
            executePaymentResult?.errorMessage ||
            "unknown error"
          }`,
          "",
        );
      }

      const appointment = await tx.appointment.findUnique({
        where: {
          id: executePaymentResult.merchantInvoiceNumber,
        },
        include: {
          schedule: true,
          patient: true,
          doctor: true,
        },
      });

      if (!appointment) {
        throw new AppError(httpStatus.NOT_FOUND, "Appointment not found", "");
      }

      if (appointment.status === AppointmentStatus.CANCELLED) {
        throw new AppError(
          httpStatus.CONFLICT,
          "This appointment was cancelled before the payment completed. The payment needs to be refunded.",
          "",
        );
      }

      // bKash can call back more than once. PENDING is the only state still
      // waiting on payment; anything else means this callback already ran, and
      // redoing it would take a second slot and reissue the serial number.
      if (appointment.status !== AppointmentStatus.PENDING) {
        return {
          executePaymentResult,
          redirectUrl: `${config.frontend_url}/dashboard/my-appointments?status=success`,
        };
      }

      const alreadyBookedSlots =
        appointment.schedule.totalSlots - appointment.schedule.availableSlots;

      const serialNumber = alreadyBookedSlots + 1;

      const joiningTime = addMinutes(
        appointment.schedule.startDateTime,
        (serialNumber - 1) * 20, // 20 minutes per slot
      );

      await tx.appointment.update({
        where: {
          id: executePaymentResult.merchantInvoiceNumber,
        },
        data: {
          status: AppointmentStatus.CONFIRMED,
          joiningTime: joiningTime,
          serialNumber: serialNumber,
        },
      });

      await tx.schedule.update({
        where: {
          id: appointment.schedule.id,
        },
        data: {
          availableSlots: {
            decrement: 1,
          },
        },
      });

      await tx.payment.update({
        where: {
          appointmentId: executePaymentResult.merchantInvoiceNumber,
          bkashPaymentId: executePaymentResult.paymentID,
        },
        data: {
          status: PaymentStatus.PAID,
          bkashTrxId: executePaymentResult.trxID,
          paidAt: executePaymentResult.paymentExecuteTime,
          gatewayResponse: executePaymentResult,
        },
      });

      // The confirmation PDF and email are built AFTER this transaction commits.
      // Rendering or SMTP failing must never roll back a payment bKash already
      // took. joiningTime/serialNumber come from the values computed above -
      // `appointment` was read before the update, so its copies are still null.
      return {
        executePaymentResult,
        confirmation: {
          patientName: appointment.patient.name,
          patientEmail: appointment.patient.email,
          doctorName: appointment.doctor.name,
          doctorEmail: appointment.doctor.email,
          scheduleDate: appointment.schedule.startDateTime.toDateString(),
          joiningTime,
          serialNumber,
          meetingLink: appointment.schedule.meetingLink,
          amount: executePaymentResult.amount,
          transactionID: executePaymentResult.trxID,
          paidAt: executePaymentResult.paymentExecuteTime,
        },
        redirectUrl: `${config.frontend_url}/dashboard/my-appointments?status=success`,
      };
    } else if (status === "failure") {
      await tx.payment.update({
        where: {
          bkashPaymentId: paymentId,
        },
        data: {
          status: PaymentStatus.FAILED,
          gatewayResponse: executePaymentResult,
        },
      });
      return {
        redirectUrl: `${config.frontend_url}/dashboard/my-appointments?status=failure`,
      };
    } else if (status === "cancel") {
      await tx.payment.update({
        where: {
          bkashPaymentId: paymentId,
        },
        data: {
          status: PaymentStatus.CANCELLED,
          gatewayResponse: executePaymentResult,
        },
      });
      return {
        executePaymentResult,
        redirectUrl: `${config.frontend_url}/dashboard/my-appointments?status=cancel`,
      };
    } else {
      return {
        executePaymentResult,
        redirectUrl: `${config.frontend_url}/dashboard/my-appointments?error=payment-failed`,
      };
    }
  },
  {
      maxWait: 10000, // Maximum time to wait for the transaction to complete (in milliseconds)
      timeout: 30000, // Maximum time for the entire transaction to complete (in milliseconds)
    });
  const confirmation = transactionResult?.confirmation;
  if (confirmation) {
    try {
      const pdfBuffer = await buildAppointmentConfirmationPdf(confirmation);
      const html = await ejs.renderFile(
        path.join(
          process.cwd(),
          "src/app/templates/appointment-confirmation.ejs",
        ),
        { ...confirmation, paymentMethod: "bKash" },
      );

      await transporter.sendMail({
        from: config.email_sender,
        to: confirmation.patientEmail,
        subject: "Your New Appointment Booked",
        html,
        attachments: [
          {
            filename: "appointment-confirmation.pdf",
            content: pdfBuffer,
          },
        ],
      });
    } catch (error) {
      // The booking is already paid and confirmed - log and move on.
      console.error("Appointment confirmation email failed:", error);
    }
  }

  return transactionResult; // Return the result
};

const cancelAppointment = async (
  payload: ICancelAppointmentPayload,
  user: RequestUser,
) => {
  const transactionResult = await prisma.$transaction(async (tx) => {
    const appointmentId = payload.appointmentId;

    const existingAppointment = await tx.appointment.findUnique({
      where: {
        id: appointmentId,
        patient: {
          email: user.email,
        },
      },
      include: {
        payment: true,
        schedule: true,
      },
    });
    if (!existingAppointment) {
      throw new AppError(httpStatus.NOT_FOUND, "Appointment not found", "");
    }
    if (
      existingAppointment.status === "ONGOING" ||
      existingAppointment.status === "COMPLETED"
    ) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Appointment cannot be cancelled as it is already ongoing or completed",
        "",
      );
    }
    if (existingAppointment.status === "CANCELLED") {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Appointment is already cancelled",
        "",
      );
    }

    const updatedAppointment = await tx.appointment.update({
      where: {
        id: appointmentId,
      },
      data: {
        status: AppointmentStatus.CANCELLED,
      },
    });

    // Only a CONFIRMED appointment ever consumed a slot - an unpaid PENDING one
    // never decremented, so returning a slot here would invent one.
    if (existingAppointment.status === AppointmentStatus.CONFIRMED) {
      await tx.schedule.update({
        where: {
          id: existingAppointment.schedule.id,
        },
        data: {
          availableSlots: {
            increment: 1,
          },
        },
      });
    }

    //refund logic

    const now = new Date();
    const startDateTime = existingAppointment.schedule.startDateTime;
    const refundCutoffTime = subHours(startDateTime, 1); // 1 hour before the schedule start time
    const isEligibleForRefund = isBefore(now, refundCutoffTime);

    if (isEligibleForRefund) {
      const bkashIdToken = await getBkashIdToken();
      if (!bkashIdToken) {
        throw new AppError(
          httpStatus.BAD_GATEWAY,
          "Failed to get bkash id token",
          "",
        );
      }

      const bkashRefundPaymentResponse = await fetch(
        `${config.bkash_base_url}/tokenized/checkout/payment/refund`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            authorization: bkashIdToken,
            "x-app-key": config.bkash_app_key,
          },
          body: JSON.stringify({
            paymentID: existingAppointment.payment?.bkashPaymentId,
            trxID: existingAppointment.payment?.bkashTrxId,
            amount: existingAppointment.payment?.amount.toString(),
            sku: "APPOINTMENT_REFUND",
            reason: "patient cancelled the appointment",
          }),
        },
      );

      const bkashRefundPaymentResult = await bkashRefundPaymentResponse.json();
      console.log(bkashRefundPaymentResult);
      await tx.payment.update({
        where: {
          appointmentId: existingAppointment.id,
        },
        data: {
          refundTrxId: bkashRefundPaymentResult.refundTrxID,
          refundedAt: bkashRefundPaymentResult.completedTime,
          refundAmount: bkashRefundPaymentResult.amount,
          refundReason: "patient cancelled the appointment",
          status: PaymentStatus.REFUNDED,
          gatewayResponse: bkashRefundPaymentResult,
        },
      });
    }
    const newPaymentInfo = await tx.payment.findUnique({
      where: {
        appointmentId: existingAppointment.id,
      },
    });

    return {
      appointment: updatedAppointment,
      payment: newPaymentInfo,
    };
  });
  return transactionResult;
};

const updateAppointmentStatus = async (
  appointmentId: string,
  payload: IUpdateAppointmentStatusPayload,
  user: RequestUser,
) => {
  const doctor = await prisma.doctor.findUnique({
    where: {
      userId: user.userId,
    },
  });

  if (!doctor) {
    throw new AppError(httpStatus.NOT_FOUND, "Doctor not found", "");
  }

  const appointment = await prisma.appointment.findUnique({
    where: {
      id: appointmentId,
      doctorId: doctor.id,
    },
  });

  if (!appointment) {
    throw new AppError(httpStatus.NOT_FOUND, "Appointment not found", "");
  }
  if (appointment.status === AppointmentStatus.COMPLETED) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Cannot update status of a completed appointment",
      "",
    );
  }

  if (appointment.status === AppointmentStatus.CANCELLED) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Cannot update status of a cancelled appointment",
      "",
    );
  }
  if (appointment.status === AppointmentStatus.PENDING) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Cannot update status of an unpaid appointment",
      "",
    );
  }

  if (appointment.status === AppointmentStatus.CONFIRMED) {
    if (payload.status !== "ONGOING") {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Can only update status to ONGOING from CONFIRMED",
        "",
      );
    }
    await prisma.appointment.update({
      where: {
        id: appointment.id,
      },
      data: {
        status: AppointmentStatus.ONGOING,
      },
    });
  }

  if (appointment.status === AppointmentStatus.ONGOING) {
    if (payload.status !== "COMPLETED") {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Can only update status to COMPLETED from ONGOING",
        "",
      );
    }
    await prisma.appointment.update({
      where: {
        id: appointment.id,
      },
      data: {
        status: AppointmentStatus.COMPLETED,
      },
    });
  }

  const updatedAppointment = await prisma.appointment.findUnique({
    where: {
      id: appointment.id,
    },
  });
  return updatedAppointment;
};

//patient appointment list, doctor appointment list, all appointment list, single appointment details
const getAppointments = async (query: IQuery, user: RequestUser) => {
  const limit = query.limit ? Number(query.limit) : 10;
  const page = query.page ? Number(query.page) : 1;
  const skip = (page - 1) * limit;

  const sortBy = query.sortBy ? query.sortBy : "createdAt";
  const sortOrder = query.sortOrder === "desc" ? "desc" : "asc";

  const patient = await prisma.patient.findUnique({
    where: {
      userId: user.userId,
    },
  });
  if (!patient) {
    throw new AppError(
      httpStatus.NOT_FOUND,
      "Patient not found for the user",
      "",
    );
  }
  const andConditions: AppointmentWhereInput[] = [
    {
      patientId: patient.id,
    },
  ];
  if (query.status) {
    andConditions.push({
      status: query.status,
    });
  }

  const appointments = await prisma.appointment.findMany({
    where: {
      AND: andConditions,
    },
    take: limit,
    skip,
    orderBy: {
      [sortBy]: sortOrder,
    },
    include: {
      doctor: {
        select: {
          id: true,
          name: true,
          specialization: true,
        },
      },
      schedule: true,
      payment: true,
    },
  });

  const total = await prisma.appointment.count({
    where: {
      AND: andConditions,
    },
  });
  return {
    data: appointments,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};
//doctor appointment list, all appointment list, single appointment details
const getDoctorAppointments = async (query: IQuery, user: RequestUser) => {
  const limit = query.limit ? Number(query.limit) : 10;
  const page = query.page ? Number(query.page) : 1;
  const skip = (page - 1) * limit;

  const sortBy = query.sortBy ? query.sortBy : "createdAt";
  const sortOrder = query.sortOrder === "desc" ? "desc" : "asc";

  const doctor = await prisma.doctor.findUnique({
    where: {
      userId: user.userId,
    },
  });

  if (!doctor) {
    throw new AppError(httpStatus.NOT_FOUND, "Doctor not found", "");
  }

  const andConditions: AppointmentWhereInput[] = [
    {
      doctorId: doctor.id,
    },
  ];
  if (query.status) {
    andConditions.push({
      status: query.status,
    });
  }

  const appointments = await prisma.appointment.findMany({
    where: {
      AND: andConditions,
    },
    take: limit,
    skip,
    orderBy: {
      [sortBy]: sortOrder,
    },
    include: {
      patient: {
        select: {
          id: true,
          name: true,
          email: true,
          contactNumber: true,
        },
      },
      schedule: true,
      payment: true,
    },
  });
  const total = await prisma.appointment.count({
    where: {
      AND: andConditions,
    },
  });
  return {
    data: appointments,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};
//all appointment list, single appointment details
const getAllAppointments = async (query: IQuery) => {
  const limit = query.limit ? Number(query.limit) : 10;
  const page = query.page ? Number(query.page) : 1;
  const skip = (page - 1) * limit;

  const sortBy = query.sortBy ? query.sortBy : "createdAt";
  const sortOrder = query.sortOrder === "desc" ? "desc" : "asc";

  const andConditions: AppointmentWhereInput[] = [];

  if (query.status) {
    andConditions.push({
      status: query.status,
    });
  }
  if (query.doctorId) {
    andConditions.push({
      doctorId: query.doctorId,
    });
  }

  if (query.patientId) {
    andConditions.push({
      patientId: query.patientId,
    });
  }
  if (query.doctorEmail) {
    andConditions.push({
      doctor: {
        email: query.doctorEmail,
      },
    });
  }
  if (query.patientEmail) {
    andConditions.push({
      patient: {
        email: query.patientEmail,
      },
    });
  }
  const appointments = await prisma.appointment.findMany({
    where: {
      AND: andConditions,
    },
    take: limit,
    skip,
    orderBy: {
      [sortBy]: sortOrder,
    },
    include: {
      patient: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      doctor: {
        select: {
          id: true,
          name: true,
          email: true,
          specialization: true,
        },
      },
      schedule: true,
      payment: true,
    },
  });
  const total = await prisma.appointment.count({
    where: {
      AND: andConditions,
    },
  });
  return {
    data: appointments,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

const getSingleAppointments = async (
  appointmentId: string,
  user: RequestUser,
) => {
  const appointment = await prisma.appointment.findUnique({
    where: {
      id: appointmentId,
    },
    include: {
      patient: {
        select: {
          id: true,
          name: true,
          email: true,
          userId: true,
        },
      },
      doctor: {
        select: {
          id: true,
          name: true,
          specialization: true,
          userId: true,
        },
      },
      schedule: true,
      payment: true,
    },
  });

  if (!appointment) {
    throw new AppError(httpStatus.NOT_FOUND, "Appointment not found", "");
  }

  if (user.role === Role.PATIENT) {
    if (appointment.patient.userId !== user.userId) {
      throw new AppError(
        httpStatus.FORBIDDEN,
        "You are not the owner of this appointment",
        "",
      );
    }
  }
  if (user.role === Role.DOCTOR) {
    if (appointment.doctor.userId !== user.userId) {
      throw new AppError(
        httpStatus.FORBIDDEN,
        "You are not the owner of this appointment",
        "",
      );
    }
  }

  return appointment;
};

export const AppointmentService = {
  bookAppointment,
  payAppointment,
  bookAppointmentCallback,
  cancelAppointment,
  updateAppointmentStatus,
  getAppointments,
  getDoctorAppointments,
  getAllAppointments,
  getSingleAppointments,
};
