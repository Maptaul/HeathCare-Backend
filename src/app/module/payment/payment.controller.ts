import { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse.js";
import { paymentService } from "./payment.service";

const getMyPayments = catchAsync(async (req: Request, res: Response) => {
  const user = req.user!;
  const { data, meta } = await paymentService.getMyPayments(req.query, user);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Payments retrieved successfully",
    data,
    meta,
  });
});

const getAllPayments = catchAsync(async (req: Request, res: Response) => {
  const { data, meta } = await paymentService.getAllPayments(req.query);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Payments retrieved successfully",
    data,
    meta,
  });
});

const getSinglePayment = catchAsync(async (req: Request, res: Response) => {
  const paymentId = req.params.paymentId as string;
  const user = req.user!;
  const result = await paymentService.getSinglePayment(paymentId, user);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Payment retrieved successfully",
    data: result,
  });
});

export const paymentController = {
  getMyPayments,
  getAllPayments,
  getSinglePayment,
};
