import { z } from "zod";

export const ApplyAsDoctorValidationZodSchema = z.object({
  user: z.object({
    name: z.string().trim().min(2, "Name is required"),
    email: z.email("Invalid email").trim().toLowerCase(),
  }),
  doctor: z.object({
    address: z.string().trim().min(5, "Address is required").optional(),
    specialization: z.string().trim().min(2, "Specialization is required"),
    licenseNumber: z.string().trim().min(2, "License number is required"),
    qualifications: z.string().trim().min(2, "Qualifications are required"),
    experienceYears: z
      .number()
      .int()
      .min(0, "Experience must be a positive number"),
    bio: z.string().trim().optional(),
    consultationFee: z
      .number()
      .min(0, "Consultation fee must be a positive number")
      .optional(),
    contactNumber: z
      .string()
      .trim()
      .min(5, "Contact number is required")
      .optional(),
  }),
});
export const UpdateProfileDoctorValidationZodSchema = z.object({
  doctor: z.object({
    address: z.string().trim().min(5, "Address is required").optional(),
    bio: z.string().trim().max(500, "Bio must be less than or equal to 500 characters").optional(),
    consultationFee: z
      .number()
      .min(0, "Consultation fee must be a positive number")
      .optional(),
    contactNumber: z
      .string()
      .trim()
      .min(5, "Contact number is required")
      .optional(),
  }),
});

export const PublicDoctorListQueryValidationZodSchema = z.object({
  searchTerm: z.string().trim().optional(),
  specialization: z.string().trim().optional(),
  page: z
    .string()
    .regex(/^[1-9]\d*$/, "Page must be a positive integer")
    .optional(),
  limit: z
    .string()
    .regex(/^[1-9]\d*$/, "Limit must be a positive integer")
    .optional(),
  sortBy: z.string().trim().optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
});

