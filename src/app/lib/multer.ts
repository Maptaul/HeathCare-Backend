import httpStatus from "http-status";
import multer from "multer";
import { AppError } from "../utils/appError.js";

export const MAX_FILE_SIZE_IN_MB = 5;

const MAX_FILE_SIZE_IN_BYTES = MAX_FILE_SIZE_IN_MB * 1024 * 1024;

const ACCEPTED_FILE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/jpg",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

const storage = multer.memoryStorage();

export const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_IN_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!ACCEPTED_FILE_TYPES.includes(file.mimetype)) {
      return cb(
        new AppError(
          httpStatus.BAD_REQUEST,
          `File type not allowed: ${file.originalname}`,
          "",
        ),
      );
    }
    cb(null, true);
  },
});
