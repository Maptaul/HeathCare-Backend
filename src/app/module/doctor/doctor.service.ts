import bcrypt from "bcryptjs";
import { UploadApiResponse } from "cloudinary";
import crypto from "crypto";
import ejs from "ejs";
import httpStatus from "http-status";
import path from "path";
import {
  DoctorVerificationStatus,
  Role,
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
  IVerifyDoctorEmailPayload,
} from "./doctor.interface.js";

const applyAsDoctor = async (
  payload: IApplyAsDoctorPayload,
  resume: Express.Multer.File | null,
  additionalFiles: Express.Multer.File[],
) => {
  const isUserExists = await prisma.user.findUnique({
    where: {
      email: payload.user.email,
    },
  });
  if (isUserExists) {
    throw new AppError(
      httpStatus.CONFLICT,
      "User already exists with this email",
      "",
    );
  }

  const resumeUploadResult = await new Promise<UploadApiResponse>(
    (resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          {
            resource_type: "auto",
          },
          async (error, result) => {
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
          },
        )
        .end(resume?.buffer);
    },
  );

  const additionalFilesUploadResults = await Promise.all(
    additionalFiles.map((file) => {
      return new Promise<UploadApiResponse>((resolve, reject) => {
        cloudinary.uploader
          .upload_stream(
            {
              resource_type: "auto",
            },
            async (error, result) => {
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
            },
          )
          .end(file?.buffer);
      });
    }),
  );

  const randomDoctorPassword = Math.random().toString(36).slice(-8);
  const hashedPassword = await bcrypt.hash(
    randomDoctorPassword,
    Number(config.bcrypt_salt_rounds),
  );

  const doctorApplication = await prisma.user.create({
    data: {
      ...payload.user,
      password: hashedPassword,
      role: Role.DOCTOR,
      needPasswordChange: true,
      doctor: {
        create: {
          name: payload.user.name,
          email: payload.user.email,
          ...payload.doctor,
          resume: resumeUploadResult.secure_url,
          resumePublicId: resumeUploadResult.public_id,
          additionalFiles: additionalFilesUploadResults.map((file) => ({
            url: file.secure_url,
            publicId: file.public_id,
          })),
        },
      },
    },
    include: {
      doctor: true,
    },
  });

  const expirationSeconds = 60 * 60;
  const otpKey = `doctor-application:otp:${payload.user.email}`;

  const otpValue = crypto.randomInt(100000, 1000000).toString();

  await redisClient.set(otpKey, otpValue, {
    expiration: {
      type: "EX",
      value: expirationSeconds,
    },
  });

  const templatePath = path.join(
    process.cwd(),
    "src/app/templates/registration-user-otp.ejs",
  );

  const templateData = {
    name: payload.user.name,
    email: payload.user.email,
    otp: otpValue,
    expirationMinutes: expirationSeconds / 60,
  };

  const html = await ejs.renderFile(templatePath, templateData);

  await transporter.sendMail({
    from: config.email_sender,
    to: payload.user.email,
    subject: "Doctor Application OTP",
    html,
  });

  return doctorApplication;
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

export const DoctorServices = {
  applyAsDoctor,
  verifyDoctorEmail,
  approveDoctor,
  getAllDoctors,
};
