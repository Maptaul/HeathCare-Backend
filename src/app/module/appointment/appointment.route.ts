import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { auth } from "../../middleware/checkAuth.js";
import { ValidateRequest } from "../../middleware/validateRequest.js";
import { AppointmentController } from "./appointment.controller.js";
import {
  BookAppointmentStatusValidationSchema,
  UpdateAppointmentStatusValidationSchema,
} from "./appointment.validation.js";

const router = Router();

router.post(
  "/book-appointment",
  auth(Role.PATIENT),
  ValidateRequest(BookAppointmentStatusValidationSchema),
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

router.patch(
  "/update-status/:appointmentId",
  auth(Role.DOCTOR),
  ValidateRequest(UpdateAppointmentStatusValidationSchema),
  AppointmentController.updateAppointmentStatus,
);

router.get(
  "/my-appointments",
  auth(Role.PATIENT),
  AppointmentController.getAppointments,
);

router.get(
  "/doctor-appointments",
  auth(Role.DOCTOR),
  AppointmentController.getDoctorAppointments,
);

router.get(
  "/all-appointments",
  auth(Role.ADMIN, Role.SUPER_ADMIN),
  AppointmentController.getAllAppointments,
);

router.get(
  "/:appointmentId",
  auth(Role.PATIENT, Role.DOCTOR, Role.ADMIN, Role.SUPER_ADMIN),
  AppointmentController.getSingleAppointments,
);

export const AppointmentRoutes = router;
