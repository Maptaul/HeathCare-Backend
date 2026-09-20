import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { upload } from "../../lib/multer.js";
import { auth } from "../../middleware/checkAuth.js";
import { ValidateRequest } from "../../middleware/validateRequest.js";
import { DoctorController } from "./doctor.controller.js";
import {
  ApproveDoctorValidationZodSchema,
  UpdateDoctorProfileValidationZodSchema,
} from "./doctor.validation.js";

const router = Router();

router.post(
  "/apply-as-doctor",
  // ValidateRequest(UserValidation.ResetPasswordZodSchema),
  upload.fields([
    { name: "resume", maxCount: 1 },
    { name: "additionalFiles", maxCount: 10 },
  ]),
  DoctorController.ApplyAsDoctor,
);
router.post(
  "/apply-as-doctor/verify-email",
  DoctorController.verifyDoctorEmail,
);

router.post(
  "/approve-doctor",
  auth(Role.ADMIN, Role.SUPER_ADMIN),
  ValidateRequest(ApproveDoctorValidationZodSchema),
  DoctorController.approveDoctor,
);

router.get(
  "/all-doctors",
  auth(Role.ADMIN, Role.SUPER_ADMIN),
  DoctorController.getAllDoctors,
);

router.patch(
  "/update-my-profile",
  auth(Role.DOCTOR),
  ValidateRequest(UpdateDoctorProfileValidationZodSchema),
  DoctorController.updateDoctorProfile,
);

router.get(
  "/public/available-today",
  DoctorController.getAvailableDoctorsByTodaySchedule,
);

router.get("/public/all-doctors", DoctorController.getAllDoctorsListPublic);

// Keep this dynamic route last so it does not shadow the static routes above.
router.get("/public/:doctorId", DoctorController.getSingleDoctorPublicProfile);

export const DoctorRoutes = router;
