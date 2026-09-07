import cookieParser from "cookie-parser";
import cors from "cors";
import express, {
  type Application,
  NextFunction,
  type Request,
  type Response,
} from "express";
import httpStatus from "http-status";
import config from "./app/config/index.js";
import { getBkashIdToken } from "./app/lib/bkash.js";
import { globalErrorHandler } from "./app/middleware/globalErrorHandler.js";
import { notFound } from "./app/middleware/notFound.js";
import { AppointmentRoutes } from "./app/module/appointment/appointment.route.js";
import { AuthRoutes } from "./app/module/auth/auth.route.js";
import { DoctorRoutes } from "./app/module/doctor/doctor.route.js";
import { UserRoutes } from "./app/module/user/user.route.js";

const app: Application = express();

app.use(
  cors({
    origin: config.frontend_url,
    credentials: true,
  }),
);

// Enable URL-encoded form data parsing
app.use(express.urlencoded({ extended: true }));

// Middleware to parse JSON bodies
app.use(express.json());
app.use(cookieParser());

app.use("/api/v1/auth", AuthRoutes);
app.use("/api/v1/user", UserRoutes);
app.use("/api/v1/appointment", AppointmentRoutes);
app.use("/api/v1/doctor", DoctorRoutes);

app.get("/test", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const grantIdTokenResult = await getBkashIdToken();

    console.log(grantIdTokenResult);

    res.status(httpStatus.OK).json({
      success: true,
      message: "Welcome to Healthcare System Backend",
      data: null,
    });
  } catch (error) {
    console.log(error);
    next(error);
  }
});

// Basic route
app.get("/", async (req: Request, res: Response) => {
  res.status(httpStatus.OK).json({
    success: true,
    statusCode: httpStatus.OK,
    message: "Welcome to Healthcare System Backend API",
    data: {
      name: "MessMate",
      description: "Smart Healthcare System",
      version: "v1",
    },
  });
});

app.use(globalErrorHandler);
app.use(notFound);

export default app;
