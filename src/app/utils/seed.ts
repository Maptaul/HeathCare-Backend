import bcrypt from "bcryptjs";
import { Role } from "../../generated/prisma/enums";
import config from "../config";
import { prisma } from "../lib/prisma";

export const seedSuperAdmin = async () => {
  try {
    const isSuperAdminExists = await prisma.user.findFirst({
      where: {
        role: Role.SUPER_ADMIN,
      },
    });
    if (isSuperAdminExists) {
      console.log("Super admin already exists.");
      return;
    }
    const name = config.super_admin_name;
    const email = config.super_admin_email;
    const password = config.super_admin_password;

    if (!name || !email || !password) {
      throw new Error(
        "Super admin credentials are not defined in the environment variables.",
      );
    }

    const hashedPassword = await bcrypt.hash(
      password,
      Number(config.bcrypt_salt_rounds),
    );
    const superAdmin = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role: Role.SUPER_ADMIN,
        needPasswordChange: false,
        emailVerified: true,
      },
    });

    console.log("super Admin Created : ", superAdmin);
  } catch (error) {
    console.error("Error seeding super admin:", error);
    await prisma.user.delete({
      where: {
        email: config.super_admin_email,
      },
    });
  }
};

// create tester admin
export const seedTesterAdmin = async () => {
  try {
    const isTesterAdminExists = await prisma.user.findUniqueOrThrow({
      where: {
        email: config.tester_admin_email,
      },
    });
    if (isTesterAdminExists) {
      console.log("Tester admin already exists.");
      return;
    }
    const name = config.tester_admin_name;
    const email = config.tester_admin_email;
    const password = config.tester_admin_password;

    if (!name || !email || !password) {
      throw new Error(
        "Tester admin credentials are not defined in the environment variables.",
      );
    }

    const hashedPassword = await bcrypt.hash(
      password,
      Number(config.bcrypt_salt_rounds),
    );
    const testerAdmin = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role: Role.ADMIN,
        needPasswordChange: false,
        emailVerified: true,
      },
    });

    console.log("Tester Admin Created : ", testerAdmin);
  } catch (error) {
    console.error("Error seeding tester admin:", error);
  }
};

//create tester doctor
export const seedTesterDoctor = async () => {
  try {
    const isTesterDoctorExists = await prisma.user.findUnique({
      where: {
        email: config.tester_doctor_email,
      },
    });
    if (isTesterDoctorExists) {
      console.log("Tester doctor already exists.");
      return;
    }
    const name = config.tester_doctor_name;
    const email = config.tester_doctor_email;
    const password = config.tester_doctor_password;

    if (!name || !email || !password) {
      throw new Error(
        "Tester doctor credentials are not defined in the environment variables.",
      );
    }

    const hashedPassword = await bcrypt.hash(
      password,
      Number(config.bcrypt_salt_rounds),
    );
    const testerDoctor = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role: Role.DOCTOR,
        needPasswordChange: false,
        emailVerified: true,
        doctor: {
          create: {
            email,
            name,
            experienceYears: 5,
            licenseNumber: "LIC123456",
            qualifications: "MBBS",
            specialization: "General Medicine",
          },
        },
      },
    });

    console.log("Tester Doctor Created : ", testerDoctor);
  } catch (error) {
    console.error("Error seeding tester doctor:", error);
  }
};
