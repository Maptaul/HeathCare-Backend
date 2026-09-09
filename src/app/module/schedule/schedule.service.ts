import { prisma } from "../../lib/prisma";
import { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/appError";
import { CreateSchedulePayload } from "./schedule.interface";
import httpStatus from "http-status";

const createSchedule = async (
  payload: CreateSchedulePayload,
  user: RequestUser,
) => {
  const doctor = await prisma.doctor.findUnique({
    where: {
      userId: user.userId,
    },
  });

  if (!doctor) {
    throw new AppError(httpStatus.NOT_FOUND, "Doctor not found");
  }
};

export const scheduleService = {
  createSchedule,
};
