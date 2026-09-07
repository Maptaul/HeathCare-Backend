import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { auth } from "../../middleware/checkAuth.js";
import { AppointmentController } from "./appointment.controller.js";

const router = Router();

router.post(
  "/book-appointment",
  auth(Role.PATIENT),
  AppointmentController.bookAppointment,
);
router.post(
  "/pay-appointment",
  auth(Role.PATIENT),
  AppointmentController.payAppointment,
);
router.post(
  "/cancel-appointment",
  auth(Role.PATIENT, Role.ADMIN, Role.SUPER_ADMIN),
  AppointmentController.cancelAppointment,
);
// book appointment callback url
router.get(
  "/book-appointment/payment/callback",
  AppointmentController.bookAppointmentCallback,
);
export const AppointmentRoutes = router;
