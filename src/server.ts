import app from "./app.js";
import config from "./app/config/index.js";
import { deleteUnverifiedDoctors } from "./app/lib/cron.js";
import { transporter } from "./app/lib/nodemailer.js";
import { prisma } from "./app/lib/prisma.js";
import { redisClient } from "./app/lib/redis.js";
import {
  seedSuperAdmin,
  seedTesterAdmin,
  seedTesterDoctor,
} from "./app/utils/seed.js";

const PORT = config.port;

const main = async () => {
  try {
    await prisma.$connect();
    console.log("Connected to the database successfully.");
    await redisClient.connect();
    console.log("Connected to Redis successfully.");
    await transporter.verify();
    console.log("Nodemailer Connected successfully.");
    await seedSuperAdmin();
    await seedTesterAdmin();
    await seedTesterDoctor();

    await deleteUnverifiedDoctors();

    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Error starting the server:", error);
    await prisma.$disconnect();
    process.exit(1);
  }
};

main();
