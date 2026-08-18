import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { ValidateRequest } from "../../middleware/validateRequest";
import { AuthController } from "./auth.controller";
import { UserValidation } from "./auth.validation";

const router = Router();

router.post(
  "/register",

  // (req: Request, res: Response, next: NextFunction) => {
  //   try {
  //     const payload = req.body ?? {};
  //     const result =
  //       patientValidation.PatientRegistrationZodSchema.safeParse(payload);

  //     if (!result.success) {
  //       // let errorMessage = "";
  //       // payload.error.issues.forEach((issue) => {
  //       //   errorMessage = errorMessage.concat(" ") + issue;
  //       // });
  //       console.log(result.error);
  //       console.log(result.error.issues);
  //       throw new Error(result.error.issues[0].message);
  //     }

  //     req.body = result.data;

  //     next();
  //   } catch (error) {
  //     next(error);
  //   }
  // },

  ValidateRequest(UserValidation.PatientRegistrationZodSchema),

  AuthController.registerPatient,
);
router.post(
  "/verify-email",

  ValidateRequest(UserValidation.PatientEmailVerificationZodSchema),

  AuthController.verifyPatientEmail,
);

router.post(
  "/login",

  ValidateRequest(UserValidation.LoginZodSchema),

  AuthController.loginUser,
);
router.get(
  "/me",
  auth(Role.ADMIN, Role.DOCTOR, Role.PATIENT, Role.SUPER_ADMIN),
  // validate request(UserValidation.LoginZodSchema),
  AuthController.getMe,
);
router.post("/refresh-token", AuthController.refreshToken);
router.post("/google", AuthController.googleLogin);
router.post(
  "/forgot-password",
  ValidateRequest(UserValidation.ForgotPasswordZodSchema),
  AuthController.forgotPassword,
);
router.post(
  "/reset-password",
  ValidateRequest(UserValidation.ResetPasswordZodSchema),
  AuthController.resetPassword,
);
export const AuthRoutes = router;
