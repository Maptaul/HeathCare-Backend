import { NextFunction, Request, Response } from "express";
import httpStatus from "http-status";
import z from "zod";
import { catchAsync } from "../utils/catchAsync.js";
import { AppError } from "../utils/appError.js";

type TRequestSource = "body" | "params" | "query";

export const ValidateRequest = (
  zodSchema: z.ZodObject,
  source: TRequestSource = "body",
) => {
  return catchAsync((req: Request, res: Response, next: NextFunction) => {
    try {
      const payload = req[source] ?? {};
      const result = zodSchema.safeParse(payload);

      if (!result.success) {
        throw new AppError(
          httpStatus.BAD_REQUEST,
          result.error.issues[0].message,
          "",
        );
      }

      if (source === "query") {
        // req.query has no setter in Express 5, so it must be redefined
        // instead of reassigned.
        Object.defineProperty(req, "query", {
          value: result.data,
          writable: true,
          configurable: true,
        });
      } else {
        req[source] = result.data;
      }

      next();
    } catch (error) {
      next(error);
    }
  });
};
