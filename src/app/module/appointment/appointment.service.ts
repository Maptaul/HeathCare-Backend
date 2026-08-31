import {
  AppointmentStatus,
  PaymentStatus,
} from "../../../generated/prisma/enums";
import config from "../../config";
import { getBkashIdToken } from "../../lib/bkash";
import { prisma } from "../../lib/prisma";
import { RequestUser } from "../../middleware/checkAuth";
import crypto from "crypto";

const bookAppointment = async (payload: any, user: RequestUser) => {
  const transactionResult = await prisma.$transaction(async (tx) => {
    // business logic for booking an appointment would go here

    const appointment = await tx.appointment.create({
      data: {
        status: AppointmentStatus.PENDING,
      },
    });

    const bkashIdToken = await getBkashIdToken();
    if (!bkashIdToken) {
      throw new Error("Failed to get bkash id token");
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
          amount: "500", // Replace with actual amount (e.g., "500" for 500 BDT)
          currency: "BDT", // Replace with actual currency (e.g., "BDT" for Bangladeshi Taka)
          intent: "authorization", // Replace with actual intent (e.g., "authorization" or "sale")
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
        amount: "1200",
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
  });
  if (!existingAppointment) {
    throw new Error("Appointment not found");
  }
  if (existingAppointment.status !== "PENDING") {
    throw new Error("appointments is not in pending state, cannot be paid");
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
  const bkashIdToken = await getBkashIdToken();
  if (!bkashIdToken) {
    throw new Error("Failed to get bkash id token");
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
        amount: "500", // Replace with actual amount (e.g., "500" for 500 BDT)
        currency: "BDT", // Replace with actual currency (e.g., "BDT" for Bangladeshi Taka)
        intent: "authorization", // Replace with actual intent (e.g., "authorization" or "sale")
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
      throw new Error("Payment ID is required");
    }
    const status = query.status;
    if (!status) {
      throw new Error("Status is required");
    }

    const bkashIdToken = await getBkashIdToken();
    if (!bkashIdToken) {
      throw new Error("Failed to get bkash id token");
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
      await tx.appointment.update({
        where: {
          id: executePaymentResult.merchantInvoiceNumber,
        },
        data: {
          status: AppointmentStatus.CONFIRMED,
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
      throw new Error("Appointment not found");
    }
    if (
      existingAppointment.status === "ONGOING" ||
      existingAppointment.status === "COMPLETED"
    ) {
      throw new Error(
        "Appointment cannot be cancelled as it is already ongoing or completed",
      );
    }
    if (existingAppointment.status === "CANCELLED") {
      throw new Error("Appointment is already cancelled");
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
      throw new Error("Failed to get bkash id token");
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
          paymentId: existingAppointment.payment?.bkashPaymentId,
          trxId: existingAppointment.payment?.bkashTrxId,
          refundAmount: existingAppointment.payment?.amount,
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
        refundTrxId: bkashRefundPaymentResult.refundTrxId,
        refundedAt: bkashRefundPaymentResult.completedTime,
        refundAmount: bkashRefundPaymentResult.refundAmount,
        refundReason: bkashRefundPaymentResult.reason,
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
