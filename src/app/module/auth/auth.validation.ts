import z from "zod";

const PatientRegistrationZodSchema = z.object({
  name: z
    .string("Not a string")
    .min(3, "Name must be at least 3 characters long")
    .max(10, "Name must be at most 10 characters long"),
  email: z.email("Not a valid email"),
  password: z
    .string("Not a string")
    .min(8, "Password must be at least 8 characters long")
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
      "Password must contain at least one uppercase letter, one lowercase letter, one digit, and one special character",
    ),
  patient: z
    .object({
      contactNumber: z.string("Not a string").optional(),
    })
    .optional(),
});

const LoginZodSchema = z.object({
  email: z.email("Not a valid email"),
  password: z
    .string("Not a string")
    .min(8, "Password must be at least 8 characters long")
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
      "Password must contain at least one uppercase letter, one lowercase letter, one digit, and one special character",
    ),
});

export const patientValidation = {
  PatientRegistrationZodSchema,
  LoginZodSchema,
};
