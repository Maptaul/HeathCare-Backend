import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { ValidateRequest } from "../../middleware/validateRequest";
import { PrescriptionController } from "./prescription.controller";
import { createPrescriptionsValidationZodSchema } from "./prescription.validation";

const router = Router();

router.post(
  "/create-prescription",
  auth(Role.DOCTOR),
  ValidateRequest(createPrescriptionsValidationZodSchema),
  PrescriptionController.createPrescription,
);

router.get(
  "/:appointmentId",
  auth(Role.PATIENT, Role.DOCTOR, Role.SUPER_ADMIN),
  PrescriptionController.getSinglePrescription,
);

export const PrescriptionRoutes = router;
