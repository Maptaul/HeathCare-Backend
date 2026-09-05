import { Router } from "express";
import { upload } from "../../lib/multer";
import { DoctorController } from "./doctor.controller";
import { auth } from "../../middleware/checkAuth";
import { Role } from "../../../generated/prisma/enums";

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
