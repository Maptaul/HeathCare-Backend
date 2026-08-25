import { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { AppointmentService } from "./appointment.service";

const bookAppointment = catchAsync(async (req: Request, res: Response) => {
  const payload = req.body;
  const user = req.user;
  if (!user) {
    throw new Error("User is not authenticated");
  }
  const result = await AppointmentService.bookAppointment(payload, user);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Appointment booked successfully",
    data: result,
  });
});
const bookAppointmentCallback = catchAsync(
  async (req: Request, res: Response) => {
    console.log(req.query, "req.query");
    const { executePaymentResult, redirectUrl } =
      await AppointmentService.bookAppointmentCallback(req.query);
    console.log(executePaymentResult, "executePaymentResult");
    res.redirect(redirectUrl);
    // sendResponse(res, {
    //   statusCode: httpStatus.OK,
    //   success: true,
    //   message: "Appointment callback processed successfully",
    //   data: result,
    // });
  },
);

export const AppointmentController = {
  bookAppointment,
  bookAppointmentCallback,
};
