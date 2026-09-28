import bcrypt from "bcryptjs";
import { UploadApiResponse } from "cloudinary";
import crypto from "crypto";
import { addDays, startOfDay } from "date-fns";
import ejs from "ejs";
import httpStatus from "http-status";
import path from "path";
import {
  DoctorVerificationStatus,
  Role,
  ScheduleStatus,
} from "../../../generated/prisma/client.js";
import { DoctorWhereInput } from "../../../generated/prisma/models.js";
import config from "../../config/index.js";
import { IQuery } from "../../interfaces/index.js";
import { cloudinary } from "../../lib/cloudinary.js";
import { transporter } from "../../lib/nodemailer.js";
import { prisma } from "../../lib/prisma.js";
import { redisClient } from "../../lib/redis.js";
import { RequestUser } from "../../middleware/checkAuth.js";
import { AppError } from "../../utils/appError.js";
import {
  IApplyAsDoctorPayload,
  IApproveDoctorPayload,
  IUpdateDoctorProfilePayload,
  IVerifyDoctorEmailPayload,
} from "./doctor.interface.js";

const DOCTOR_OTP_EXPIRATION_SECONDS = 60 * 60;

const uploadToCloudinary = (file: Express.Multer.File) =>
  new Promise<UploadApiResponse>((resolve, reject) => {
    cloudinary.uploader
      .upload_stream({ resource_type: "auto" }, (error, result) => {
        if (error) {
          return reject(error);
        }
        if (!result) {
          return reject(
            new AppError(
              httpStatus.INTERNAL_SERVER_ERROR,
              "No result returned from Cloudinary",
              "",
            ),
          );
        }
        resolve(result);
      })
      .end(file.buffer);
  });

const sendDoctorApplicationOtp = async (name: string, email: string) => {
  const otpKey = `doctor-application:otp:${email}`;
  const otpValue = crypto.randomInt(100000, 1000000).toString();

  await redisClient.set(otpKey, otpValue, {
    expiration: {
      type: "EX",
      value: DOCTOR_OTP_EXPIRATION_SECONDS,
    },
  });

  const templatePath = path.join(
    process.cwd(),
    "src/app/templates/registration-user-otp.ejs",
  );

  const html = await ejs.renderFile(templatePath, {
    name,
    email,
    otp: otpValue,
    expirationTime: DOCTOR_OTP_EXPIRATION_SECONDS / 60,
  });

  await transporter.sendMail({
    from: config.email_sender,
    to: email,
    subject: "Doctor Application OTP",
    html,
  });
};

const applyAsDoctor = async (
  payload: IApplyAsDoctorPayload,
  resume: Express.Multer.File | null,
  additionalFiles: Express.Multer.File[],
) => {
  const { email, name } = payload.user;

  const existingUser = await prisma.user.findUnique({
    where: { email },
  });
  if (existingUser) {
    const isPendingDoctor =
      existingUser.role === Role.DOCTOR && !existingUser.emailVerified;
    throw new AppError(
      httpStatus.CONFLICT,
      isPendingDoctor
        ? "An application with this email is awaiting email verification. Please verify your email or resend the OTP."
        : "User already exists with this email",
      "",
    );
  }

  const existingLicense = await prisma.doctor.findUnique({
    where: { licenseNumber: payload.doctor.licenseNumber },
  });
  if (existingLicense) {
    throw new AppError(
      httpStatus.CONFLICT,
      "An application with this license number already exists",
      "",
    );
  }

  const resumeUploadResult = resume ? await uploadToCloudinary(resume) : null;
  const additionalFilesUploadResults = await Promise.all(
    additionalFiles.map(uploadToCloudinary),
  );

  // Doctor sets their own password via forgot-password after approval
  const randomDoctorPassword = crypto.randomBytes(16).toString("hex");
  const hashedPassword = await bcrypt.hash(
    randomDoctorPassword,
    Number(config.bcrypt_salt_rounds),
  );

  let doctorApplication;
  try {
    doctorApplication = await prisma.user.create({
      data: {
        ...payload.user,
        password: hashedPassword,
        role: Role.DOCTOR,
        needPasswordChange: true,
        doctor: {
          create: {
            name,
            email,
            ...payload.doctor,
            resume: resumeUploadResult?.secure_url,
            resumePublicId: resumeUploadResult?.public_id,
            additionalFiles: additionalFilesUploadResults.map((file) => ({
              url: file.secure_url,
              publicId: file.public_id,
            })),
          },
        },
      },
      omit: { password: true },
      include: {
        doctor: true,
      },
    });
  } catch (error) {
    // Don't leave orphaned uploads behind when the DB write fails
    const uploads = [resumeUploadResult, ...additionalFilesUploadResults];
    await Promise.allSettled(
      uploads
        .filter((upload): upload is UploadApiResponse => upload !== null)
        .map((upload) =>
          cloudinary.uploader.destroy(upload.public_id, {
            resource_type: upload.resource_type,
          }),
        ),
    );
    throw error;
  }

  try {
    await sendDoctorApplicationOtp(name, email);
  } catch (error) {
    // Application is already saved; the doctor can use "Resend" on the verify page
    console.error("Failed to send doctor application OTP", error);
  }

  return doctorApplication;
};

const resendDoctorOtp = async (rawEmail: string) => {
  const email = rawEmail.trim().toLowerCase();

  const existingUser = await prisma.user.findUnique({
    where: { email },
  });
  if (!existingUser || existingUser.role !== Role.DOCTOR) {
    throw new AppError(
      httpStatus.NOT_FOUND,
      "Doctor application not found",
      "",
    );
  }
  if (existingUser.emailVerified) {
    throw new AppError(httpStatus.BAD_REQUEST, "Email already verified", "");
  }

  await sendDoctorApplicationOtp(existingUser.name, email);
};

const verifyDoctorEmail = async (payload: IVerifyDoctorEmailPayload) => {
  const otp = payload.otp;
  const email = payload.email.trim().toLowerCase();
  const existingUser = await prisma.user.findUnique({
    where: {
      email,
      role: Role.DOCTOR,
    },
  });
  if (!existingUser) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found", "");
  }
  if (existingUser.emailVerified) {
    throw new AppError(httpStatus.BAD_REQUEST, "Email already verified", "");
  }
  const otpKey = `doctor-application:otp:${email}`;
  const redisOtp = await redisClient.get(otpKey);
  if (!redisOtp) {
    throw new AppError(httpStatus.BAD_REQUEST, "OTP expired or not found", "");
  }
  if (redisOtp !== otp) {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid OTP", "");
  }

  await redisClient.del(otpKey);

  const verifiedUser = await prisma.user.update({
    where: { id: existingUser.id },
    data: { emailVerified: true },
    omit: { password: true },
    include: { doctor: true },
  });
  return verifiedUser;
};

const approveDoctor = async (
  payload: IApproveDoctorPayload,
  reviewer: RequestUser,
) => {
  const { doctorId, verificationStatus, rejectionReason } = payload;

  const existingDoctor = await prisma.doctor.findUnique({
    where: { id: doctorId },
    include: { user: true },
  });

  if (!existingDoctor) {
    throw new AppError(httpStatus.NOT_FOUND, "Doctor not found", "");
  }

  if (existingDoctor.isDeleted) {
    throw new AppError(httpStatus.FORBIDDEN, "Doctor is deleted", "");
  }

  if (!existingDoctor.user.emailVerified) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "Doctor email is not verified",
      "",
    );
  }

  if (existingDoctor.verificationStatus !== DoctorVerificationStatus.PENDING) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Doctor is already ${existingDoctor.verificationStatus.toLocaleLowerCase()}`,
      "",
    );
  }

  if (
    verificationStatus === DoctorVerificationStatus.REJECTED &&
    !rejectionReason
  ) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Rejection reason is required for rejected status",
      "",
    );
  }

  const updatedDoctor = await prisma.doctor.update({
    where: { id: doctorId },
    data: {
      verificationStatus,
      rejectionReason:
        verificationStatus === DoctorVerificationStatus.REJECTED
          ? rejectionReason
          : null,
      reviewedBy: reviewer.userId,
      reviewedAt: new Date(),
    },
  });

  const isApproved = verificationStatus === DoctorVerificationStatus.APPROVED;
  const templatePath = path.join(
    process.cwd(),
    `src/app/templates/${isApproved ? "doctor-application-approved.ejs" : "doctor-application-rejected.ejs"}`,
  );

  const templateData = {
    name: updatedDoctor.name,
    reason: updatedDoctor.rejectionReason,
  };

  const html = await ejs.renderFile(templatePath, templateData);

  await transporter.sendMail({
    from: config.email_sender,
    to: updatedDoctor.email,
    subject: `Doctor Application ${isApproved ? "Your Application Has Been Approved" : "Your Application Has Been Rejected"}`,
    html,
  });

  return updatedDoctor;
};

const getAllDoctors = async (query: IQuery) => {
  //search, filter, pagination, sorting

  const limit = query.limit ? Number(query.limit) : 10;
  const page = query.page ? Number(query.page) : 1;
  const skip = (page - 1) * limit;
  const sortBy = query.sortBy ? query.sortBy : "createdAt";
  const sortOrder = query.sortOrder === "desc" ? "desc" : "asc";
  const andConditions: DoctorWhereInput[] = [];

  //search term filter
  if (query.searchTerm) {
    andConditions.push({
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
    });
  }

  //filter by verification status
  if (query.specialization) {
    andConditions.push({
      specialization: { equals: query.specialization, mode: "insensitive" },
    });
  }

  if (query.email) {
    andConditions.push({
      email: { equals: query.email, mode: "insensitive" },
    });
  }

  if (query.licenseNumber) {
    andConditions.push({
      licenseNumber: { equals: query.licenseNumber, mode: "insensitive" },
    });
  }

  if (query.verificationStatus) {
    andConditions.push({
      verificationStatus: query.verificationStatus as DoctorVerificationStatus,
    });
  }

  if (query.isDeleted) {
    andConditions.push({
      isDeleted: query.isDeleted === "true" ? true : false,
    });
  }

  andConditions.push({
    isDeleted: false,
  });

  const allDoctors = await prisma.doctor.findMany({
    where: {
      AND: andConditions.length > 0 ? andConditions : undefined,
    },
    take: limit,
    skip: skip,
    orderBy: {
      // sortBy : sortOrder
      [sortBy]: sortOrder,
    },
    include: {
      user: {
        omit: {
          password: true,
        },
      },
      // schedule : true,
      //appointments : true,
      //prescriptions : true,
    },
  });

  const totalDoctorCount = await prisma.doctor.count({
    where: {
      AND: andConditions,
    },
  });
  return {
    data: allDoctors,
    meta: {
      page: page,
      limit: limit,
      total: totalDoctorCount,
      totalPages: Math.ceil(totalDoctorCount / limit),
    },
  };
};

const updateDoctorProfile = async (
  payload: IUpdateDoctorProfilePayload,
  user: RequestUser,
) => {
  const existingDoctor = await prisma.doctor.findUnique({
    where: { userId: user.userId },
  });
  if (!existingDoctor) {
    throw new AppError(httpStatus.NOT_FOUND, "Doctor not found", "");
  }

  // Zod strips unknown keys, so a wrongly shaped body arrives here as {} and
  // would "succeed" without changing anything.
  if (Object.keys(payload).length === 0) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "No valid fields to update. Allowed: address, bio, consultationFee, contactNumber",
      "",
    );
  }

  const updatedDoctor = await prisma.doctor.update({
    where: { id: existingDoctor.id },
    data: payload,
  });

  return updatedDoctor;
};

const getAvailableDoctorsByTodaySchedule = async (query: IQuery) => {
  const limit = query.limit ? Number(query.limit) : 10;
  const page = query.page ? Number(query.page) : 1;
  const skip = (page - 1) * limit;
  const sortBy = query.sortBy ? query.sortBy : "name";
  const sortOrder = query.sortOrder === "desc" ? "desc" : "asc";

  const now = new Date();
  const startOfToday = startOfDay(now);
  const startOfTomorrow = addDays(startOfToday, 1);

  const andConditions: DoctorWhereInput[] = [
    { isDeleted: false },
    { verificationStatus: DoctorVerificationStatus.APPROVED },
    {
      schedules: {
        some: {
          isDeleted: false,
          status: ScheduleStatus.PUBLISHED,
          availableSlots: { gt: 0 },
          startDateTime: {
            gte: startOfToday,
            lt: startOfTomorrow,
            gt: now,
          },
        },
      },
    },
  ];

  if (query.searchTerm) {
    andConditions.push({
      OR: [
        { name: { contains: query.searchTerm, mode: "insensitive" } },
        {
          specialization: {
            contains: query.searchTerm,
            mode: "insensitive",
          },
        },
      ],
    });
  }

  if (query.specialization) {
    andConditions.push({
      specialization: { equals: query.specialization, mode: "insensitive" },
    });
  }

  const availableDoctors = await prisma.doctor.findMany({
    where: {
      AND: andConditions,
    },
    select: {
      id: true,
      name: true,
      specialization: true,
      licenseNumber: true,
      qualifications: true,
      experienceYears: true,
      bio: true,
      consultationFee: true,
      createdAt: true,
      schedules: {
        where: {
          isDeleted: false,
          status: ScheduleStatus.PUBLISHED,
          availableSlots: { gt: 0 },
          startDateTime: {
            gte: startOfToday,
            lt: startOfTomorrow,
            gt: now,
          },
        },
        // sortBy applies to the doctor, not the schedule — slots read best in time order.
        orderBy: { startDateTime: "asc" },
        select: {
          id: true,
          startDateTime: true,
          endDateTime: true,
          totalSlots: true,
          availableSlots: true,
        },
      },
    },
    take: limit,
    skip: skip,
    orderBy: {
      [sortBy]: sortOrder,
    },
  });

  const totalAvailableDoctorCount = await prisma.doctor.count({
    where: {
      AND: andConditions,
    },
  });

  return {
    data: availableDoctors,
    meta: {
      page: page,
      limit: limit,
      total: totalAvailableDoctorCount,
      totalPages: Math.ceil(totalAvailableDoctorCount / limit),
    },
  };
};

const getAllDoctorsListPublic = async (query: IQuery) => {
  const limit = query.limit ? Number(query.limit) : 10;
  const page = query.page ? Number(query.page) : 1;
  const skip = (page - 1) * limit;
  const sortBy = query.sortBy ? query.sortBy : "createdAt";
  const sortOrder = query.sortOrder === "desc" ? "desc" : "asc";

  const andConditions: DoctorWhereInput[] = [
    { isDeleted: false },
    { verificationStatus: DoctorVerificationStatus.APPROVED },
  ];

  if (query.searchTerm) {
    andConditions.push({
      OR: [
        { name: { contains: query.searchTerm, mode: "insensitive" } },
        {
          specialization: {
            contains: query.searchTerm,
            mode: "insensitive",
          },
        },
        {
          qualifications: {
            contains: query.searchTerm,
            mode: "insensitive",
          },
        },
      ],
    });
  }

  if (query.specialization) {
    andConditions.push({
      specialization: { equals: query.specialization, mode: "insensitive" },
    });
  }

  const publicDoctorsList = await prisma.doctor.findMany({
    where: {
      AND: andConditions,
    },
    select: {
      id: true,
      name: true,
      specialization: true,
      licenseNumber: true,
      qualifications: true,
      experienceYears: true,
      bio: true,
      consultationFee: true,
      createdAt: true,
    },
    take: limit,
    skip: skip,
    orderBy: {
      [sortBy]: sortOrder,
    },
  });

  const totalDoctorCount = await prisma.doctor.count({
    where: {
      AND: andConditions,
    },
  });

  return {
    data: publicDoctorsList,
    meta: {
      page: page,
      limit: limit,
      total: totalDoctorCount,
      totalPages: Math.ceil(totalDoctorCount / limit),
    },
  };
};

const getSingleDoctorPublicProfile = async (doctorId: string) => {
  const doctor = await prisma.doctor.findUnique({
    where: { id: doctorId },
    select: {
      id: true,
      name: true,
      specialization: true,
      licenseNumber: true,
      qualifications: true,
      experienceYears: true,
      bio: true,
      consultationFee: true,
      createdAt: true,
      isDeleted: true,
      verificationStatus: true,
      schedules: {
        where: {
          isDeleted: false,
          status: ScheduleStatus.PUBLISHED,
          availableSlots: { gt: 0 },
          startDateTime: { gt: new Date() },
        },
        orderBy: { startDateTime: "asc" },
        select: {
          id: true,
          startDateTime: true,
          endDateTime: true,
          totalSlots: true,
          availableSlots: true,
        },
      },
    },
  });

  if (
    !doctor ||
    doctor.isDeleted ||
    doctor.verificationStatus !== DoctorVerificationStatus.APPROVED
  ) {
    throw new AppError(httpStatus.NOT_FOUND, "Doctor not found", "");
  }

  const { isDeleted, verificationStatus, ...publicDoctorProfile } = doctor;

  return publicDoctorProfile;
};

export const DoctorServices = {
  applyAsDoctor,
  verifyDoctorEmail,
  resendDoctorOtp,
  approveDoctor,
  getAllDoctors,
  getSingleDoctorPublicProfile,
  getAllDoctorsListPublic,
  updateDoctorProfile,
  getAvailableDoctorsByTodaySchedule,
};
