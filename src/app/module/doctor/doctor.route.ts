import { Router } from "express";
import { upload } from "../../lib/multer.js";
import { DoctorController } from "./doctor.controller.js";
import { auth } from "../../middleware/checkAuth.js";
import { Role } from "../../../generated/prisma/enums.js";

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
router.post("/verify-doctor-email", DoctorController.verifyDoctorEmail);

router.post(
  "/approve-doctor",
  auth(Role.ADMIN, Role.SUPER_ADMIN),
  DoctorController.approveDoctor,
);

export const DoctorRoutes = router;
