import { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";

const ApplyAsDoctor = catchAsync(async (req: Request, res: Response) => {
  const resume = req.file;
  const additionalFiles = req.files;
  const data = req.body;

  console.log({ resume, additionalFiles, data });

  // const result = await DoctorServices.applyAsDoctor();
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "applied as doctor successfully",
    data: {},
  });
});

export const DoctorController = {
  ApplyAsDoctor,
};
