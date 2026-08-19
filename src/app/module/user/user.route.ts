import { Router } from "express";
import { UserController } from "./user.controller";

const router = Router();

router.patch("/profile-image", UserController.uploadProfileImage);
export const UserRoutes = router;
