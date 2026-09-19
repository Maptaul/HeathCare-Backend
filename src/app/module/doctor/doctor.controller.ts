import { Request, Response } from "express";
import httpStatus from "http-status";
import { AppError } from "../../utils/appError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { DoctorServices } from "./doctor.service.js";
import { ApplyAsDoctorValidationZodSchema } from "./doctor.validation.js";

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
    throw new AppError(httpStatus.BAD_REQUEST, "Validation failed", "");
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
  const reviewer = req.user!;
  if (!reviewer) {
    throw new AppError(
      httpStatus.UNAUTHORIZED,
      "User is not authenticated",
      "",
    );
  }

  const result = await DoctorServices.approveDoctor(payload, reviewer);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Doctor approved successfully",
    data: result,
  });
});
const getAllDoctors = catchAsync(async (req: Request, res: Response) => {
  const { data, meta } = await DoctorServices.getAllDoctors(req.query);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "All doctors retrieved successfully",
    data: data,
    meta: meta,
  });
});

const updateDoctorProfile = catchAsync(async (req: Request, res: Response) => {
  // The schema wraps the editable fields in `doctor`; Prisma needs them flat.
  const payload = req.body.doctor;
  const user = req.user!;

  const result = await DoctorServices.updateDoctorProfile(payload, user);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Doctor profile updated successfully",
    data: result,
  });
});

const getAvailableDoctorsByTodaySchedule = catchAsync(
  async (req: Request, res: Response) => {
    const { data, meta } =
      await DoctorServices.getAvailableDoctorsByTodaySchedule(req.query);
    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Available doctors retrieved successfully",
      data,
      meta,
    });
  },
);

const getAllDoctorsListPublic = catchAsync(
  async (req: Request, res: Response) => {
    const { data, meta } = await DoctorServices.getAllDoctorsListPublic(
      req.query,
    );
    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Doctors list retrieved successfully",
      data,
      meta,
    });
  },
);

const getSingleDoctorPublicProfile = catchAsync(
  async (req: Request, res: Response) => {
    const doctorId = req.params.doctorId as string;

    const result = await DoctorServices.getSingleDoctorPublicProfile(
      doctorId,
    );
    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Doctor profile retrieved successfully",
      data: result,
    });
  },
);

export const DoctorController = {
  ApplyAsDoctor,
  verifyDoctorEmail,
  approveDoctor,
  getAllDoctors,
  updateDoctorProfile,
  getAvailableDoctorsByTodaySchedule,
  getAllDoctorsListPublic,
  getSingleDoctorPublicProfile,
};
