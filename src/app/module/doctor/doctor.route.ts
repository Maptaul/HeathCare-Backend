import { Router } from "express";
import { upload } from "../../lib/multer";
import { DoctorController } from "./doctor.controller";

const router = Router();

router.post(
  "/",
  // ValidateRequest(UserValidation.ResetPasswordZodSchema),
  upload.single("resume"),
  upload.array("additionalFiles"),
  DoctorController.ApplyAsDoctor,
);
export const DoctorRoutes = router;
