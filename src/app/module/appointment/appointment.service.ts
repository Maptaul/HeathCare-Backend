import { addMinutes, isBefore, isSameDay } from "date-fns";
import ejs from "ejs";
import httpStatus from "http-status";
import path from "path";
import PDFDocument from "pdfkit";
import {
  AppointmentStatus,
  PaymentStatus,
  ScheduleStatus,
} from "../../../generated/prisma/enums.js";
import config from "../../config/index.js";
import { getBkashIdToken } from "../../lib/bkash.js";
import { transporter } from "../../lib/nodemailer.js";
import { prisma } from "../../lib/prisma.js";
import { RequestUser } from "../../middleware/checkAuth.js";
import { AppError } from "../../utils/appError.js";
import { IBookAppointmentPayload } from "./appointment.interface.js";

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

    const existingAppointment = await prisma.appointment.findFirst({
      where: {
        scheduleId: payload.scheduleId,
        patientId: patient.id,
        // status: {
        //   not: AppointmentStatus.CANCELLED,
        // },
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
        amount: amount,
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
      paymentUrl: bkashCreatePaymentResult.bkashURL,
    }; // Return the result of the bKash payment creation
  });

  return transactionResult; // Return the result of the transaction
};

const payAppointment = async (payload: any, user: RequestUser) => {
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

    const executePaymentResult = await executePaymentResponse.json();
    if (status === "success") {
      const appointment = await prisma.appointment.findUnique({
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

      // total slot = 3, available slot = 3
      // (total - available) +1

      const alreadyBookedSlots =
        appointment.schedule.totalSlots -
        appointment.schedule.availableSlots +
        1;

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

      const newAvailableSlots = appointment.schedule.availableSlots - 1;

      await prisma.schedule.update({
        where: {
          id: appointment.schedule.id,
        },
        data: {
          availableSlots: newAvailableSlots,
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

      //pdf generation and email sending logic

      const pdfDocument = new PDFDocument({
        margin: 50,
      });

      const pdfChunks: Buffer[] = [];
      pdfDocument.on("data", (chunk: Buffer) => {
        pdfChunks.push(chunk);
      });

      const pdfReadyPromise = new Promise<Buffer>((resolve, reject) => {
        pdfDocument.on("end", () => {
          const pdfBuffer = Buffer.concat(pdfChunks);
          resolve(pdfBuffer);
        });
      });

      pdfDocument
        .fontSize(20)
        .text("Appointment Confirmation", { align: "center" });
      pdfDocument.moveDown();
      pdfDocument
        .fontSize(14)
        .text(`Patient Name: ${appointment.patient.name}`);
      pdfDocument
        .fontSize(14)
        .text(`Patient Email: ${appointment.patient.email}`);

      pdfDocument.moveDown(2);

      pdfDocument.fontSize(14).text(`Doctor Name: ${appointment.doctor.name}`);
      pdfDocument
        .fontSize(14)
        .text(`Doctor Email: ${appointment.doctor.email}`);

      pdfDocument.moveDown(2);
      pdfDocument.text(
        `Schedule Date: ${appointment.schedule.startDateTime.toDateString()}`,
      );

      pdfDocument.moveDown(2);
      pdfDocument.text(`Joining Time: ${appointment.joiningTime}`);
      pdfDocument.text(`Serial Number: ${appointment.serialNumber}`);
      pdfDocument.text(`Meeting Link: ${appointment.schedule.meetingLink}`);

      pdfDocument.moveDown();
      pdfDocument.text(`Amount Paid: ${executePaymentResult.amount} BDT`);
      pdfDocument.text(`Payment Method: bKash`);
      pdfDocument.text(`Transaction ID: ${executePaymentResult.trxID}`);
      pdfDocument.text(`Paid At: ${executePaymentResult.paymentExecuteTime}`);

      pdfDocument.end();

      const pdfBuffer = await pdfReadyPromise;

      const templatePath = path.join(
        process.cwd(),
        "src/app/templates/appointment-confirmation.ejs",
      );
      const templateData = {
        patientName: appointment.patient.name,
        patientEmail: appointment.patient.email,
        doctorName: appointment.doctor.name,
        doctorEmail: appointment.doctor.email,
        scheduleDate: appointment.schedule.startDateTime.toDateString(),
        joiningTime: appointment.joiningTime,
        serialNumber: appointment.serialNumber,
        meetingLink: appointment.schedule.meetingLink,
        amount: executePaymentResult.amount,
        paymentMethod: "bKash",
        transactionID: executePaymentResult.trxID,
        paidAt: executePaymentResult.paymentExecuteTime,
      };
      const html = await ejs.renderFile(templatePath, templateData);

      await transporter.sendMail({
        from: config.email_sender,
        to: appointment.patient.email,
        subject: "Your New Appointment Booked",
        html,
        attachments: [
          {
            filename: "appointment-confirmation.pdf",
            content: pdfBuffer,
          },
        ],
      });

      return {
        executePaymentResult,
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
          status: PaymentStatus.CANCELED,
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
  });
  return transactionResult; // Return the result
};

const cancelAppointment = async (payload: any) => {
  const transactionResult = await prisma.$transaction(async (tx) => {
    const appointmentId = payload.appointmentId;

    const existingAppointment = await tx.appointment.findUnique({
      where: {
        id: appointmentId,
      },
      include: {
        payment: true,
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
        status: "CANCELLED",
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
    const updatedPayment = await tx.payment.update({
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

    return {
      appointment: updatedAppointment,
      payment: updatedPayment,
    };
  });
  return transactionResult;
};

export const AppointmentService = {
  bookAppointment,
  payAppointment,
  bookAppointmentCallback,
  cancelAppointment,
};
