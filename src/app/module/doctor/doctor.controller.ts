import { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { DoctorServices } from "./doctor.service";
import { ApplyAsDoctorValidationZodSchema } from "./doctor.validation";

const ApplyAsDoctor = catchAsync(async (req: Request, res: Response) => {
  const files = req.files as {
    [fieldname: string]: Express.Multer.File[];
  };
  const resume = files?.["resume"] ? files["resume"][0] : null;
  const additionalFiles = files?.["additionalFiles"] || [];

  const zodValidationResult = ApplyAsDoctorValidationZodSchema.safeParse(
    JSON.parse(req.body.data),
  );
  if (!zodValidationResult.success) {
    throw new Error("Validation failed");
  }

  const payload = zodValidationResult.data;

  // if (!payload.success) {
  //   return sendResponse(res, {
  //     statusCode: httpStatus.BAD_REQUEST,
  //     success: false,
  //     message: "Validation failed",
  //     data: payload.error,
  //   });
  // }

  const result = await DoctorServices.applyAsDoctor(
    payload,
    resume,
    additionalFiles,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "applied as doctor successfully",
    data: result,
  });
});
const verifyDoctorEmail = catchAsync(async (req: Request, res: Response) => {
  const payload = req.body;

  const result = await DoctorServices.verifyDoctorEmail(payload);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Doctor Email verified successfully",
    data: result,
  });
});
const approveDoctor = catchAsync(async (req: Request, res: Response) => {
  const payload = req.body;

  const result = await DoctorServices.approveDoctor(payload);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Doctor approved successfully",
    data: result,
  });
});

export const DoctorController = {
  ApplyAsDoctor,
  verifyDoctorEmail,
  approveDoctor,
};
