import cron from "node-cron";
import {
  DoctorVerificationStatus,
  Role,
} from "../../generated/prisma/enums.js";
import { prisma } from "./prisma";

export const deleteUnverifiedDoctors = async () => {
  cron.schedule("*/10  * *  * *", async () => {
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
      const deleteDoctors = await prisma.user.deleteMany({
        where: {
          role: Role.DOCTOR,
          emailVerified: false,
          createdAt: {
            lt: oneHourAgo,
          },
          doctor: {
            verificationStatus: DoctorVerificationStatus.PENDING,
          },
        },
      });
      if (deleteDoctors.count > 0) {
        console.log(
          `Cron job: Deleted ${deleteDoctors.count} unverified doctors.`,
        );
      }
    } catch (error) {
      console.error("Cron job error:", error);
    }
    console.log("Doctor Delete cron schedule every 10 minute ");
  });
};
