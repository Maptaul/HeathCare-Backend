import { NextFunction, Request, Response } from "express";
import httpStatus from "http-status";
import z from "zod";
import { catchAsync } from "../utils/catchAsync.js";
import { AppError } from "../utils/appError.js";

export const ValidateRequest = (zodSchema: z.ZodObject) => {
  return catchAsync((req: Request, res: Response, next: NextFunction) => {
    try {
      const payload = req.body ?? {};
      const result = zodSchema.safeParse(payload);

      if (!result.success) {
        throw new AppError(
          httpStatus.BAD_REQUEST,
          result.error.issues[0].message,
          "",
        );
      }

      req.body = result.data;

      next();
    } catch (error) {
      next(error);
    }
  });
};
