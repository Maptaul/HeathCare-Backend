import { z } from "zod";

export const BookAppointmentStatusValidationSchema = z.object({
  scheduleId: z.string().min(1, "Schedule ID is required"),
});
export const UpdateAppointmentStatusValidationSchema = z.object({
  status: z.enum(
    ["ONGOING", "COMPLETED"],
    "Status must be either 'ONGOING' or 'COMPLETED'",
  ),
});
