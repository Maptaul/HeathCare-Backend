import { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { prescriptionService } from "./prescription.service";

const createPrescription = catchAsync(async (req: Request, res: Response) => {
  const payload = req.body;
  const user = req.user!;
  const result = await prescriptionService.createPrescription(payload, user);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Prescription created successfully",
    data: result,
  });
});

const getSinglePrescription = catchAsync(
  async (req: Request, res: Response) => {
    const appointmentId = req.params.appointmentId as string;
    const user = req.user!;
    const result = await prescriptionService.getSinglePrescription(
      appointmentId,
      user,
    );
    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Prescription fetched successfully",
      data: result,
    });
  },
);

export const PrescriptionController = {
  createPrescription,
  getSinglePrescription,
};
