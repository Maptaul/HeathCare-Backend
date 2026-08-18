import bcrypt from "bcryptjs";
import crypto from "crypto";
import ejs from "ejs";
import type { TokenPayload } from "google-auth-library";
import type { JwtPayload, SignOptions } from "jsonwebtoken";
import path from "path";
import {
  AuthProvider,
  Role,
  UserStatus,
} from "../../../generated/prisma/enums";
import config from "../../config";
import { googleClient } from "../../lib/googleAuth";
import { transporter } from "../../lib/nodemailer";
import { prisma } from "../../lib/prisma";
import { redisClient } from "../../lib/redis";
import { jwtUtils } from "../../utils/jwt";
import type {
  IForgotPasswordPayload,
  IGoogleLoginPayload,
  ILoginUserPayload,
  IRegisterPatientPayload,
  IRequestUser,
  IResetPasswordPayload,
  IVerifyEmailPayload,
} from "./auth.interface";

const registerPatient = async (payload: IRegisterPatientPayload) => {
  const { name, password, patient: patientData } = payload;

  const email = payload.email.trim().toLowerCase();

  const isUserExists = await prisma.user.findUnique({
    where: { email },
  });

  if (isUserExists) {
    throw new Error("User with this email already exists");
  }

  const hashedPassword = await bcrypt.hash(password, 8);

  const expirationSeconds = 60 * 5;

  // Generate OTP
  const otpKey = `patient-registration:otp:${email}`;
  const otpValue = crypto.randomInt(100000, 1000000).toString();

  await redisClient.set(otpKey, otpValue, {
    expiration: {
      type: "EX",
      value: expirationSeconds,
    },
  });

  // Save registration data in Redis
  const patientRegistrationKey = `patient-registration:data:${email}`;

  const redisUserDataPayload = {
    name,
    email,
    password: hashedPassword,
    patient: patientData,
  };

  await redisClient.set(
    patientRegistrationKey,
    JSON.stringify(redisUserDataPayload),
    {
      expiration: {
        type: "EX",
        value: expirationSeconds,
      },
    }
  );

  // Send Email
  const templatePath = path.join(
    process.cwd(),
    "src/app/templates/registration-user-otp.ejs"
  );

  const html = await ejs.renderFile(templatePath, {
    name,
    email,
    otp: otpValue,
    expirationTime: expirationSeconds / 60,
  });

  await transporter.sendMail({
    from: config.email_sender,
    to: email,
    subject: "Patient Registration OTP",
    html,
  });

  return {
    success: true,
    message: "OTP sent successfully to your email.",
  };
};

const verifyPatientEmail = async (payload: IVerifyEmailPayload) => {
  const otp = payload.otp.trim();
  const email = payload.email.trim().toLowerCase();

  // Check existing user
  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  if (existingUser?.status === UserStatus.BLOCKED) {
    throw new Error("User is blocked");
  }

  if (existingUser?.emailVerified) {
    throw new Error("Email already verified. Please login.");
  }

  if (
    existingUser?.isDeleted ||
    existingUser?.status === UserStatus.DELETED
  ) {
    throw new Error("User is deleted");
  }

  // Verify OTP
  const otpKey = `patient-registration:otp:${email}`;
  const redisOtp = await redisClient.get(otpKey);

  if (!redisOtp) {
    throw new Error("OTP expired or not found");
  }

  if (redisOtp !== otp) {
    throw new Error("Invalid OTP");
  }

  // Get Registration Data
  const patientRegistrationKey = `patient-registration:data:${email}`;
  const redisPatientData = await redisClient.get(patientRegistrationKey);

  if (!redisPatientData) {
    throw new Error("Registration data not found");
  }

  const patientPayload: IRegisterPatientPayload =
    JSON.parse(redisPatientData);

  // Final duplicate protection
  const duplicateUser = await prisma.user.findUnique({
    where: { email },
  });

  if (duplicateUser) {
    throw new Error("User already exists");
  }

  // Create User
  const createdUser = await prisma.user.create({
    data: {
      name: patientPayload.name,
      email: patientPayload.email,
      password: patientPayload.password,
      role: Role.PATIENT,
      status: UserStatus.ACTIVE,
      emailVerified: true,

      patient: {
        create: {
          name: patientPayload.name,
          email: patientPayload.email,
          contactNumber: patientPayload.patient?.contactNumber || "",
        },
      },
    },
    include: {
      patient: true,
    },
    omit: {
      password: true,
    },
  });

  // Delete Redis Keys
  await redisClient.del([otpKey, patientRegistrationKey]);

  const { patient, ...user } = createdUser;

  const jwtPayload = {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };

  const accessToken = jwtUtils.createToken(
    jwtPayload,
    config.jwt_access_secret,
    config.jwt_access_expires_in as SignOptions
  );

  const refreshToken = jwtUtils.createToken(
    jwtPayload,
    config.jwt_refresh_secret,
    config.jwt_refresh_expires_in as SignOptions
  );

  return {
    user,
    patient,
    accessToken,
    refreshToken,
  };
};

const loginUser = async (payload: ILoginUserPayload) => {
  const { password } = payload;
  const email = payload.email.trim().toLowerCase();

  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    throw new Error("User not found");
  }

  if (user.status === UserStatus.BLOCKED) {
    throw new Error("User is blocked");
  }

  if (user.isDeleted || user.status === UserStatus.DELETED) {
    throw new Error("User is deleted");
  }

  if (user.password === null && user.googleId !== null) {
    throw new Error("User registered with Google. Please login with Google.");
  }

  const isPasswordMatched = await bcrypt.compare(
    password,
    user.password as string,
  );

  if (!isPasswordMatched) {
    throw new Error("Invalid credentials");
  }

  const jwtPayload = {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };

  const accessToken = jwtUtils.createToken(
    jwtPayload,
    config.jwt_access_secret,
    config.jwt_access_expires_in as SignOptions,
  );

  const refreshToken = jwtUtils.createToken(
    jwtPayload,
    config.jwt_refresh_secret,
    config.jwt_refresh_expires_in as SignOptions,
  );

  return {
    accessToken,
    refreshToken,
  };
};

const getMe = async (user: IRequestUser) => {
  const isUserExists = await prisma.user.findUnique({
    where: {
      id: user.userId,
    },
    include: {
      patient: true,
    },
    omit: {
      password: true,
    },
  });

  if (!isUserExists) {
    throw new Error("User not found");
  }

  return isUserExists;
};

const refreshToken = async (token: string) => {
  const verifiedRefreshToken = jwtUtils.verifyToken(
    token,
    config.jwt_refresh_secret,
  );

  if (!verifiedRefreshToken.success || !verifiedRefreshToken.data) {
    throw new Error(
      config.node_env === "development"
        ? verifiedRefreshToken.error
        : "Invalid refresh token",
    );
  }

  const data = verifiedRefreshToken.data as JwtPayload;

  const user = await prisma.user.findUnique({
    where: { id: data.userId },
  });

  if (!user || user.isDeleted || user.status !== UserStatus.ACTIVE) {
    throw new Error("User is inactive or not found");
  }

  const jwtPayload = {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };

  const accessToken = jwtUtils.createToken(
    jwtPayload,
    config.jwt_access_secret,
    config.jwt_access_expires_in as SignOptions,
  );

  const refreshToken = jwtUtils.createToken(
    jwtPayload,
    config.jwt_refresh_secret,
    config.jwt_refresh_expires_in as SignOptions,
  );

  return {
    accessToken,
    refreshToken,
  };
};

const googleLogin = async (payload: IGoogleLoginPayload) => {
  let googleIdTokenPayload: TokenPayload | null | undefined = null;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: payload.idToken,
      audience: config.google_client_id,
    });
    googleIdTokenPayload = ticket.getPayload();
  } catch (error) {
    console.error("Error verifying Google ID token:", error);
    throw new Error("Invalid Google ID token");
  }

  if (!googleIdTokenPayload) {
    throw new Error("Failed to retrieve Google ID token payload");
  }

  if (!googleIdTokenPayload.email) {
    throw new Error("Email not found in Google ID token payload");
  }
  if (!googleIdTokenPayload.name) {
    throw new Error("Name not found in Google ID token payload");
  }

  const ifPatientExistWithGoogleAuh = await prisma.user.findUnique({
    where: {
      email: googleIdTokenPayload.email,
      role: Role.PATIENT,
      googleId: googleIdTokenPayload.sub,
    },
  });

  let user = ifPatientExistWithGoogleAuh;
  if (!ifPatientExistWithGoogleAuh) {
    const ifPatientExistWithCredentials = await prisma.user.findUnique({
      where: {
        email: googleIdTokenPayload.email,
        role: Role.PATIENT,
        authProvider: AuthProvider.CREDENTIAL,
      },
    });

    if (ifPatientExistWithCredentials) {
      if (ifPatientExistWithCredentials.emailVerified === false) {
        throw new Error("Email is not verified");
      }

      if (ifPatientExistWithCredentials.status === UserStatus.BLOCKED) {
        throw new Error("User is blocked");
      }
      if (
        ifPatientExistWithCredentials.isDeleted ||
        ifPatientExistWithCredentials.status === UserStatus.DELETED
      ) {
        throw new Error("User is deleted");
      }
      user = await prisma.user.update({
        where: {
          id: ifPatientExistWithCredentials.id,
        },
        data: {
          googleId: googleIdTokenPayload.sub,
        },
      });
    } else {
      // Create a new user with Google authentication
      user = await prisma.user.create({
        data: {
          name: googleIdTokenPayload.name,
          email: googleIdTokenPayload.email,
          googleId: googleIdTokenPayload.sub,
          role: Role.PATIENT,
          authProvider: AuthProvider.GOOGLE,
          emailVerified: true,
          patient: {
            create: {
              name: googleIdTokenPayload.name,
              email: googleIdTokenPayload.email,
            },
          },
        },
      });
    }
  }

  if (!user) {
    throw new Error("User not found or created");
  }
  if (user.status === UserStatus.BLOCKED) {
    throw new Error("User is blocked");
  }
  if (user.isDeleted || user.status === UserStatus.DELETED) {
    throw new Error("User is deleted");
  }

  const jwtPayload = {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };

  const accessToken = jwtUtils.createToken(
    jwtPayload,
    config.jwt_access_secret,
    config.jwt_access_expires_in as SignOptions,
  );

  const refreshToken = jwtUtils.createToken(
    jwtPayload,
    config.jwt_refresh_secret,
    config.jwt_refresh_expires_in as SignOptions,
  );

  return {
    accessToken,
    refreshToken,
  };
};

const forgotPassword = async (payload: IForgotPasswordPayload) => {
  const email = payload.email.trim().toLowerCase();
  const isUserExists = await prisma.user.findUnique({
    where: { email },
  });

  if (!isUserExists) {
    throw new Error("User not found");
  }

  if (isUserExists.status === UserStatus.BLOCKED) {
    throw new Error("User is blocked");
  }

  if (!isUserExists.emailVerified) {
    throw new Error("Email is not verified. Please verify your email first.");
  }

  if (isUserExists.isDeleted || isUserExists.status === UserStatus.DELETED) {
    throw new Error("User is deleted");
  }

  if (isUserExists.googleId && isUserExists.authProvider === "GOOGLE") {
    throw new Error("User registered with Google. Please login with Google.");
  }

  const otp = crypto.randomInt(100000, 1000000).toString();
  const key = `forgot-password:otp:${isUserExists.email}`;
  const expirationSeconds = 60 * 5; // 5 minutes
  await redisClient.set(key, otp, {
    expiration: {
      type: "EX",
      value: expirationSeconds, //
    },
  });

  const templatePath = path.join(
    process.cwd(),
    "src/app/templates/forgot-password.ejs",
  );
  const templateData = {
    name: isUserExists.name,
    otp,
    expirationTime: expirationSeconds / 60,
  };
  const html = await ejs.renderFile(templatePath, templateData);

  await transporter.sendMail({
    from: config.email_sender,
    to: isUserExists.email,
    subject: "Password Reset OTP",
    // text: `Your OTP for password reset is: ${otp}. It will expire in 5 minutes.`,
    // html: `<p>Your OTP for password reset is: <strong>${otp}</strong>. It will expire in 5 minutes.</p>`,
    html,
  });
};

const resetPassword = async (payload: IResetPasswordPayload) => {
  const { email, otp, newPassword } = payload;
  const isUserExists = await prisma.user.findUnique({
    where: { email },
  });

  if (!isUserExists) {
    throw new Error("User not found");
  }

  if (isUserExists.status === UserStatus.BLOCKED) {
    throw new Error("User is blocked");
  }

  if (!isUserExists.emailVerified) {
    throw new Error("Email is not verified. Please verify your email first.");
  }

  if (isUserExists.isDeleted || isUserExists.status === UserStatus.DELETED) {
    throw new Error("User is deleted");
  }

  if (isUserExists.googleId && isUserExists.authProvider === "GOOGLE") {
    throw new Error("User registered with Google. Please login with Google.");
  }
  const key = `forgot-password:otp:${isUserExists.email}`;
  const redisOtp = await redisClient.get(key);

  if (!redisOtp) {
    throw new Error("OTP expired or not found");
  }
  if (redisOtp !== otp) {
    throw new Error("Invalid OTP");
  }

  const hashedPassword = await bcrypt.hash(
    newPassword,
    Number(config.bcrypt_salt_rounds),
  );
  const updatedUser = await prisma.user.update({
    where: { email: isUserExists.email },
    data: { password: hashedPassword },
  });

  await redisClient.del([key]);

  const templatePath = path.join(
    process.cwd(),
    "src/app/templates/reset-password-success.ejs",
  );

  const templateData = {
    userName: isUserExists.name,
    loginUrl: `${config.frontend_url}/login`,
  };
  const html = await ejs.renderFile(templatePath, templateData);
  await transporter.sendMail({
    from: config.email_sender,
    to: isUserExists.email,
    subject: "Password Reset Successful",
    // text: `Your OTP for password reset is: ${otp}. It will expire in 5 minutes.`,
    // html: `<p>Your password has been reset successfully.</p>`,
    html,
  });
};

export const AuthService = {
  registerPatient,
  verifyPatientEmail,
  loginUser,
  getMe,
  refreshToken,
  googleLogin,
  forgotPassword,
  resetPassword,
};
