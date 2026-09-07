import type { Request, Response } from "express";
import httpStatus from "http-status";
import app from "../src/app.js";
import { prisma } from "../src/app/lib/prisma.js";
import { redisClient } from "../src/app/lib/redis.js";

// Runs once per warm serverless instance; a failed attempt is retried on the next request.
let initPromise: Promise<void> | null = null;

const init = async (): Promise<void> => {
  await prisma.$connect();
  if (!redisClient.isOpen) {
    await redisClient.connect();
  }
};

export default async function handler(
  req: Request,
  res: Response,
): Promise<void> {
  if (!initPromise) {
    initPromise = init().catch((error: unknown) => {
      initPromise = null;
      throw error;
    });
  }

  try {
    await initPromise;
  } catch (error) {
    console.error("Cold start initialization failed:", error);
    res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Service initialization failed",
    });
    return;
  }

  app(req, res);
}
