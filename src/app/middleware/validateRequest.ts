import { NextFunction, Request, Response } from "express";
import z from "zod";
import { catchAsync } from "../utils/catchAsync";

export const ValidateRequest = (zodSchema: z.ZodObject) => {
  return catchAsync((req: Request, res: Response, next: NextFunction) => {
    try {
      const payload = req.body ?? {};
      const result = zodSchema.safeParse(payload);

      if (!result.success) {
        // let errorMessage = "";
        // payload.error.issues.forEach((issue) => {
        //   errorMessage = errorMessage.concat(" ") + issue;
        // });
        console.log(result.error);
        console.log(result.error.issues);
        throw new Error(result.error.issues[0].message);
      }

      req.body = result.data;

      next();
    } catch (error) {
      next(error);
    }
  });
};
