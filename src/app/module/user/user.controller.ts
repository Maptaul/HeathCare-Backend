import { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { UserService } from "./user.service.js";

const uploadProfileImage = catchAsync(async (req: Request, res: Response) => {
  if (!req.file) {
    throw new Error("No file uploaded");
  }

  const userId = req.user?.userId;
  const result = await UserService.uploadProfileImage(req.file.buffer, userId!);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Profile image uploaded successfully",
    data: result,
  });
});

export const UserController = {
  uploadProfileImage,
};
