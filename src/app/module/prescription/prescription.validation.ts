import z from "zod";

export const createPrescriptionsValidationZodSchema = z.object({
  appointmentId: z.string().min(1, "Appointment ID is required"),
  findings: z.string().min(5, "Findings must be at least 5 characters long"),
  medicines: z.array(
    z.object({
      name: z.string().trim().min(1, "Medicine name is required"),
      dosage: z.string().trim().min(1, "Dosage is required"),
      duration: z.string().trim().min(1, "Duration is required"),
      instructions: z.string().optional(),
    }),
  ),
});
