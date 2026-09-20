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
export const UpdateDoctorProfileValidationZodSchema = z.object({
  address: z
    .string()
    .trim()
    .min(5, "Address must be at least 5 characters long")
    .optional(),

  bio: z.string().trim().max(1000, "Bio cannot exceed 1000 characters").optional(),

  consultationFee: z
    .number()
    .min(0, "Consultation fee cannot be negative")
    .optional(),

  contactNumber: z
    .string()
    .trim()
    .min(5, "Contact number is invalid")
    .optional(),
});

export const ApproveDoctorValidationZodSchema = z.object({
  doctorId: z.string().trim().min(1, "Doctor ID is required"),
  verificationStatus: z.enum(
    ["APPROVED", "REJECTED"],
    "Verification status must be either 'APPROVED' or 'REJECTED'",
  ),
  rejectionReason: z.string().trim().optional(),
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

