import { z } from "zod";

export const CreateScheduleValidationZodSchema = z.object({
  startDateTime: z.coerce.date("Start date and time is required"),
  endDateTime: z.coerce.date("End date and time is required"),
  meetingLink: z.url("Invalid meeting link").trim(),
});

export const UpdateScheduleValidationZodSchema = z.object({
  startDateTime: z.coerce.date("Start date and time is required").optional(),
  endDateTime: z.coerce.date("End date and time is required").optional(),
  meetingLink: z.url("Invalid meeting link").trim().optional(),
});
