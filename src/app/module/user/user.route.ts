import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { upload } from "../../lib/multer.js";
import { auth } from "../../middleware/checkAuth.js";
import { UserController } from "./user.controller.js";

const router = Router();

router.patch(
  "/profile-image",
  auth(Role.SUPER_ADMIN, Role.ADMIN, Role.DOCTOR, Role.PATIENT),
  upload.single("profileImage"),
  UserController.uploadProfileImage,
);
export const UserRoutes = router;
