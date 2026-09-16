import { Request, Response } from "express";
import httpStatus from "http-status";
import { AppError } from "../../utils/appError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { AppointmentService } from "./appointment.service.js";

const bookAppointment = catchAsync(async (req: Request, res: Response) => {
  const payload = req.body;
  const user = req.user;
  if (!user) {
    throw new AppError(
      httpStatus.UNAUTHORIZED,
      "User is not authenticated",
      "",
    );
  }
  const result = await AppointmentService.bookAppointment(payload, user);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Appointment booked successfully",
    data: result,
  });
});

const payAppointment = catchAsync(async (req: Request, res: Response) => {
  const payload = req.body;
  const user = req.user;
  if (!user) {
    throw new AppError(
      httpStatus.UNAUTHORIZED,
      "User is not authenticated",
      "",
    );
  }
  const result = await AppointmentService.payAppointment(payload, user);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Appointment initiated successfully",
    data: result,
  });
});
const cancelAppointment = catchAsync(async (req: Request, res: Response) => {
  const payload = req.body;
  const user = req.user;

  const result = await AppointmentService.cancelAppointment(payload, user!);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Appointment cancelled successfully",
    data: result,
  });
});

const bookAppointmentCallback = catchAsync(
  async (req: Request, res: Response) => {
    const { redirectUrl } = await AppointmentService.bookAppointmentCallback(
      req.query,
    );

    res.redirect(redirectUrl);
    // sendResponse(res, {
    //   statusCode: httpStatus.OK,
    //   success: true,
    //   message: "Appointment callback processed successfully",
    //   data: result,
    // });
  },
);

const updateAppointmentStatus = catchAsync(
  async (req: Request, res: Response) => {
    const appointmentId = req.params.appointmentId as string;
    const payload = req.body;
    const user = req.user!;

    const result = await AppointmentService.updateAppointmentStatus(
      appointmentId,
      payload,
      user,
    );
    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Appointment status updated successfully",
      data: result,
    });
  },
);

const getAppointments = catchAsync(async (req: Request, res: Response) => {
  const user = req.user!;
  const { data, meta } = await AppointmentService.getAppointments(
    req.query,
    user,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Appointments fetched successfully",
    data,
    meta,
  });
});

const getDoctorAppointments = catchAsync(
  async (req: Request, res: Response) => {
    const user = req.user!;

    const { data, meta } = await AppointmentService.getDoctorAppointments(
      req.query,
      user,
    );
    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Doctor appointments fetched successfully",
      data,
      meta,
    });
  },
);

const getAllAppointments = catchAsync(async (req: Request, res: Response) => {
  const { data, meta } = await AppointmentService.getAllAppointments(req.query);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "All appointments fetched successfully",
    data,
    meta,
  });
});

const getSingleAppointments = catchAsync(
  async (req: Request, res: Response) => {
    const appointmentId = req.params.appointmentId as string;
    const user = req.user!;

    const result = await AppointmentService.getSingleAppointments(
      appointmentId,
      user,
    );
    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Single appointment fetched successfully",
      data: result,
    });
  },
);

export const AppointmentController = {
  bookAppointment,
  payAppointment,
  cancelAppointment,
  bookAppointmentCallback,
  updateAppointmentStatus,
  getAppointments,
  getDoctorAppointments,
  getAllAppointments,
  getSingleAppointments,
};
