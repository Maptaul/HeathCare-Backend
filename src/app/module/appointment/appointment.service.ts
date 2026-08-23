import config from "../../config";
import { getBkashIdToken } from "../../lib/bkash";

const bookAppointment = async () => {
  // business logic for booking an appointment would go here

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
        payerReference: "01723888888", // Replace with actual payer reference (e.g., phone number)
        callbackURL: `${config.bkash_callback_url}/appointment/book-appointment/payment/callback`, // Replace with actual callback URL
        merchantAssociationInfo: "MI05MID54RF09123456One", // Replace with actual merchant association info
        amount: "500", // Replace with actual amount (e.g., "500" for 500 BDT)
        currency: "BDT", // Replace with actual currency (e.g., "BDT" for Bangladeshi Taka)
        intent: "authorization", // Replace with actual intent (e.g., "authorization" or "sale")
        merchantInvoiceNumber: "Inv0124", // Replace with actual merchant invoice number
      }),
    },
  );

  const bkashCreatePaymentResult = await bkashCreatePaymentResponse.json();

  return bkashCreatePaymentResult; // Return the result of the bKash payment creation
};

const bookAppointmentCallback = async (query: Record<string, any>) => {
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
  const excutePaymentResponse = await fetch(
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

  const excutePaymentResult = await excutePaymentResponse.json();
  return excutePaymentResult; // Return the result of the bKash payment execution
};

export const AppointmentService = {
  bookAppointment,
  bookAppointmentCallback,
};
