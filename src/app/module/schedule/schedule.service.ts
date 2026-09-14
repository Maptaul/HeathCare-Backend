import {
  addDays,
  differenceInMinutes,
  isAfter,
  isSameDay,
  startOfDay,
} from "date-fns";
import httpStatus from "http-status";
import { ScheduleStatus } from "../../../generated/prisma/browser";
import { ScheduleWhereInput } from "../../../generated/prisma/models";
import { IQuery } from "../../interfaces";
import { prisma } from "../../lib/prisma";
import { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/appError";
import {
  ICreateSchedulePayload,
  IUpdateSchedulePayload,
} from "./schedule.interface";

const createSchedule = async (
  payload: ICreateSchedulePayload,
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

  if (!isSameDay(payload.startDateTime, payload.endDateTime)) {
    throw new AppError(
      httpStatus.CONFLICT,
      "Start time must be on the same day as end time",
    );
  }
  if (isAfter(payload.startDateTime, payload.endDateTime)) {
    throw new AppError(
      httpStatus.CONFLICT,
      "Start time must be before end time",
    );
  }

  //
  const startOfTheDay = startOfDay(payload.startDateTime); // 25 august 2023 00:00:00
  const startOfNextDay = addDays(startOfTheDay, 1); // 26 august 2023 00:00:00

  const existingSchedulesOnThisDate = await prisma.schedule.findMany({
    where: {
      doctorId: doctor.id,
      isDeleted: false,
      startDateTime: {
        gte: startOfTheDay,
        lt: startOfNextDay,
      },
    },
  });

  if (existingSchedulesOnThisDate) {
    throw new AppError(
      httpStatus.CONFLICT,
      "Schedule already exists for this date",
    );
  }
  const durationInMinutes = differenceInMinutes(
    payload.startDateTime,
    payload.endDateTime,
  );
  const MINUTES_ALLOCATED_PER_SLOT = 20;

  const totalSlots = Math.floor(durationInMinutes / MINUTES_ALLOCATED_PER_SLOT);

  const schedule = await prisma.schedule.create({
    data: {
      startDateTime: payload.startDateTime,
      endDateTime: payload.endDateTime,
      meetingLink: payload.meetingLink,
      totalSlots,
      availableSlots: totalSlots,
      doctorId: doctor.id,
    },
    include: {
      doctor: {
        select: {
          name: true,
          email: true,
          contactNumber: true,
        },
      },
    },
  });
  return schedule;
};

const getMySchedules = async (query: IQuery, user: RequestUser) => {
  const limit = query.limit ? Number(query.limit) : 10;
  const page = query.page ? Number(query.page) : 1;
  const skip = (page - 1) * limit;
  const sortBy = query.sortBy ? query.sortBy : "createdAt";
  const sortOrder = query.sortOrder === "desc" ? "desc" : "asc";

  const doctor = await prisma.doctor.findUnique({
    where: {
      userId: user.userId,
    },
  });
  if (!doctor) {
    throw new AppError(httpStatus.NOT_FOUND, "Doctor not found");
  }

  // let limit = 10;
  // if (query.limit) {
  //   limit = Number(query.limit);
  // }
  // let page = 1;
  // if (query.page) {
  //   page = Number(query.page);
  // }

  // const skip = (page - 1) * limit;

  const andConditions: ScheduleWhereInput[] = [
    {
      doctorId: doctor.id,
    },
    {
      isDeleted: false,
    },
  ];

  if (query.status) {
    andConditions.push({
      status: query.status,
    });
  }

  const schedules = await prisma.schedule.findMany({
    where: {
      AND: andConditions,
    },
    skip,
    take: limit,
    orderBy: {
      // startDateTime: "desc",
      [sortBy]: sortOrder,
    },
    include: {
      appointments: {
        include: {
          patient: true,
        },
      },
    },
  });
  const total = await prisma.schedule.count({
    where: {
      AND: andConditions,
    },
  });
  return {
    data: schedules,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

const getAllSchedules = async (query: IQuery) => {
  const limit = query.limit ? Number(query.limit) : 10;
  const page = query.page ? Number(query.page) : 1;
  const skip = (page - 1) * limit;

  const sortBy = query.sortBy ? query.sortBy : "createdAt";
  const sortOrder = query.sortOrder === "desc" ? "desc" : "asc";

  const andConditions: ScheduleWhereInput[] = [];

  if (query.doctorId) {
    andConditions.push({
      doctorId: query.doctorId,
    });
  }
  if (query.email) {
    andConditions.push({
      doctor: {
        email: query.email,
      },
    });
  }

  if (query.status) {
    andConditions.push({
      status: query.status,
    });
  }

  //search term filter
  if (query.searchTerm) {
    andConditions.push({
      doctor: {
        OR: [
          {
            name: {
              contains: query.searchTerm,
              mode: "insensitive",
            },
          },
          {
            email: {
              contains: query.searchTerm,
              mode: "insensitive",
            },
          },
          {
            specialization: {
              contains: query.searchTerm,
              mode: "insensitive",
            },
          },
          {
            licenseNumber: {
              contains: query.searchTerm,
              mode: "insensitive",
            },
          },
        ],
      },
    });
  }

  const schedules = await prisma.schedule.findMany({
    where: {
      AND: andConditions,
    },
    skip,
    take: limit,
    orderBy: {
      // startDateTime: "desc",
      [sortBy]: sortOrder,
    },
    include: {
      appointments: {
        include: {
          patient: true,
        },
      },
    },
  });
  const total = await prisma.schedule.count({
    where: {
      AND: andConditions,
    },
  });
  return {
    data: schedules,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

const getScheduleById = async (scheduleId: string) => {
  const schedule = await prisma.schedule.findUnique({
    where: {
      id: scheduleId,
    },
    include: {
      doctor: {
        select: {
          id: true,
          name: true,
          email: true,
          specialization: true,
          userId: true,
        },
      },
      appointments: {
        include: {
          patient: true,
        },
      },
    },
  });

  if (!schedule || schedule.isDeleted) {
    throw new AppError(httpStatus.NOT_FOUND, "Schedule not found");
  }

  return schedule;
};

const updateSchedule = async (
  scheduleId: string,
  payload: IUpdateSchedulePayload,
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
  const schedule = await prisma.schedule.findUnique({
    where: {
      id: scheduleId,
      doctorId: doctor.id,
    },
  });
  if (!schedule || schedule.isDeleted) {
    throw new AppError(httpStatus.NOT_FOUND, "Schedule not found");
  }

  if (
    schedule.status === ScheduleStatus.PUBLISHED &&
    schedule.totalSlots !== schedule.availableSlots
  ) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "You cannot update a completed or cancelled schedule",
    );
  }
  // if (schedule.doctorId !== doctor.id) {
  //   throw new AppError(
  //     httpStatus.FORBIDDEN,
  //     "You are not authorized to update this schedule",
  //   );
  // }

  // const updateData: IUpdateSchedulePayload = {};

  // if (payload.meetingLink) {
  //   updateData.meetingLink = payload.meetingLink || schedule.meetingLink;
  // }

  payload.meetingLink = payload.meetingLink || schedule.meetingLink;
  payload.startDateTime = payload.startDateTime || schedule.startDateTime;
  payload.endDateTime = payload.endDateTime || schedule.endDateTime;

  if (!isSameDay(payload.startDateTime, payload.endDateTime)) {
    throw new AppError(
      httpStatus.CONFLICT,
      "Start time must be on the same day as end time",
    );
  }
  if (isAfter(payload.startDateTime, payload.endDateTime)) {
    throw new AppError(
      httpStatus.CONFLICT,
      "Start time must be before end time",
    );
  }

  //
  const startOfTheDay = startOfDay(payload.startDateTime); // 25 august 2023 00:00:00
  const startOfNextDay = addDays(startOfTheDay, 1); // 26 august 2023 00:00:00

  const existingSchedulesOnThisDate = await prisma.schedule.findMany({
    where: {
      doctorId: doctor.id,
      isDeleted: false,
      startDateTime: {
        gte: startOfTheDay,
        lt: startOfNextDay,
      },
    },
  });

  if (existingSchedulesOnThisDate) {
    throw new AppError(
      httpStatus.CONFLICT,
      "Schedule already exists for this date",
    );
  }

  const durationInMinutes = differenceInMinutes(
    payload.startDateTime,
    payload.endDateTime,
  );
  const MINUTES_ALLOCATED_PER_SLOT = 20;
  const totalSlots = Math.floor(durationInMinutes / MINUTES_ALLOCATED_PER_SLOT);
  const updatedSchedule = await prisma.schedule.update({
    where: {
      id: scheduleId,
    },
    data: {
      startDateTime: payload.startDateTime,
      endDateTime: payload.endDateTime,
      meetingLink: payload.meetingLink,
      totalSlots,
      availableSlots: totalSlots,
      doctorId: doctor.id,
    },
    include: {
      doctor: {
        select: {
          name: true,
          email: true,
          contactNumber: true,
        },
      },
    },
  });

  return updatedSchedule;
};

const publishSchedule = async (scheduleId: string, user: RequestUser) => {
  const doctor = await prisma.doctor.findUnique({
    where: {
      userId: user.userId,
    },
  });
  if (!doctor) {
    throw new AppError(httpStatus.NOT_FOUND, "Doctor not found");
  }
  const schedule = await prisma.schedule.findUnique({
    where: {
      id: scheduleId,
      doctorId: doctor.id,
    },
  });
  if (!schedule || schedule.isDeleted) {
    throw new AppError(httpStatus.NOT_FOUND, "Schedule not found");
  }
  if (schedule.status === ScheduleStatus.PUBLISHED) {
    throw new AppError(httpStatus.BAD_REQUEST, "Schedule is already published");
  }

  const publishedSchedule = await prisma.schedule.update({
    where: {
      id: schedule.id,
    },
    data: {
      status: ScheduleStatus.PUBLISHED,
    },
  });

  return publishedSchedule;
};

const deleteSchedule = async (scheduleId: string, user: RequestUser) => {
  const doctor = await prisma.doctor.findUnique({
    where: {
      userId: user.userId,
    },
  });
  if (!doctor) {
    throw new AppError(httpStatus.NOT_FOUND, "Doctor not found");
  }
  const schedule = await prisma.schedule.findUnique({
    where: {
      id: scheduleId,
      doctorId: doctor.id,
    },
  });
  if (!schedule || schedule.isDeleted) {
    throw new AppError(httpStatus.NOT_FOUND, "Schedule not found");
  }
  if (
    schedule.status === ScheduleStatus.PUBLISHED &&
    schedule.totalSlots !== schedule.availableSlots
  ) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "You cannot delete a completed or cancelled schedule",
    );
  }

  const deletedSchedule = await prisma.schedule.update({
    where: {
      id: schedule.id,
    },
    data: {
      isDeleted: true,
      deletedAt: new Date(),
    },
  });

  return deletedSchedule;
};

const getTodaysSchedules = async (query: IQuery) => {
  if (!query.doctorId) {
    throw new AppError(httpStatus.NOT_FOUND, "Doctor ID is required");
  }

  const doctor = await prisma.doctor.findUnique({
    where: {
      id: query.doctorId,
    },
  });
  if (!doctor) {
    throw new AppError(httpStatus.NOT_FOUND, "Doctor not found");
  }

  const limit = query.limit ? Number(query.limit) : 10;
  const page = query.page ? Number(query.page) : 1;
  const skip = (page - 1) * limit;

  const sortBy = query.sortBy ? query.sortBy : "createdAt";
  const sortOrder = query.sortOrder === "desc" ? "desc" : "asc";

  const now = new Date();
  const startOfToday = startOfDay(now);
  const startOfTomorrow = addDays(startOfToday, 1);

  const andConditions: ScheduleWhereInput[] = [
    {
      doctorId: query.doctorId,
    },
    {
      isDeleted: false,
    },
    {
      status: ScheduleStatus.PUBLISHED,
    },
    {
      startDateTime: {
        gte: startOfToday,
        lt: startOfTomorrow,
        gt: now,
      },
    },
    {
      availableSlots: {
        gt: 0,
      },
    },
  ];

  // if (query.specialization) {
  //   andConditions.push({
  //     doctor: {
  //       specialization: {
  //         equals: query.specialization,
  //         mode: "insensitive",
  //       },
  //     },
  //   });
  // }
  // if (query.searchTerm) {
  //   andConditions.push({
  //     doctor: {
  //       OR: [
  //         {
  //           name: {
  //             contains: query.searchTerm,
  //             mode: "insensitive",
  //           },
  //         },
  //         {
  //           specialization: {
  //             contains: query.searchTerm,
  //             mode: "insensitive",
  //           },
  //         },
  //       ],
  //     },
  //   });
  // }

  const schedules = await prisma.schedule.findMany({
    where: {
      AND: andConditions,
    },
    skip,
    take: limit,
    orderBy: {
      // startDateTime: "desc",
      [sortBy]: sortOrder,
    },
  });
  const total = await prisma.schedule.count({
    where: {
      AND: andConditions,
    },
  });
  return {
    data: schedules,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

export const scheduleService = {
  createSchedule,
  getMySchedules,
  getAllSchedules,
  getScheduleById,
  updateSchedule,
  publishSchedule,
  deleteSchedule,
  getTodaysSchedules,
};
