import { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { AnalyticsService } from "./analytics.service";

const getPatientAnalytics = catchAsync(async (req: Request, res: Response) => {
  const user = req.user!;

  const result = await AnalyticsService.getPatientAnalytics(user);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Patient analytics fetched successfully",
    data: result,
  });
});

const getDoctorAnalytics = catchAsync(async (req: Request, res: Response) => {
  const user = req.user!;
  const result = await AnalyticsService.getDoctorAnalytics(user);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Doctor analytics fetched successfully",
    data: result,
  });
});
const getAdminAnalytics = catchAsync(async (req: Request, res: Response) => {
  const result = await AnalyticsService.getAdminAnalytics();
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Admin analytics fetched successfully",
    data: result,
  });
});

export const AnalyticsController = {
  getPatientAnalytics,
  getDoctorAnalytics,
  getAdminAnalytics,
};
