import { UploadApiResponse } from "cloudinary";
import ejs from "ejs";
import httpStatus from "http-status";
import path from "path";
import { AppointmentStatus, Role } from "../../../generated/prisma/enums";
import config from "../../config";
import { cloudinary } from "../../lib/cloudinary";
import { transporter } from "../../lib/nodemailer";
import { prisma } from "../../lib/prisma";
import { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/appError";
import { ICreatePrescriptionPayload } from "./prescription.interface";
import { buildPrescriptionPdf, IPrescriptionPdfData } from "./prescription.pdf";

const createPrescription = async (
  payload: ICreatePrescriptionPayload,
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

  const appointment = await prisma.appointment.findUnique({
    where: {
      id: payload.appointmentId,
      doctorId: doctor.id,
    },
    include: {
      patient: true,
    },
  });
  if (!appointment) {
    throw new AppError(httpStatus.NOT_FOUND, "Appointment not found");
  }

  if (appointment.status !== AppointmentStatus.COMPLETED) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Cannot create prescription for an appointment that is not completed",
    );
  }

  if (appointment.prescriptionUrl) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Prescription already exists for this appointment",
    );
  }

  const prescriptionData: IPrescriptionPdfData = {
    patientName: appointment.patient.name,
    patientEmail: appointment.patient.email,
    doctorName: doctor.name,
    doctorSpecialization: doctor.specialization,
    doctorLicenseNumber: doctor.licenseNumber,
    findings: payload.findings,
    medicines: payload.medicines,
  };

  const pdfBuffer = await buildPrescriptionPdf(prescriptionData);

  const uploadResult = await new Promise<UploadApiResponse>(
    (resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          {
            resource_type: "raw",
            format: "pdf",
          },
          (error, result) => {
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
        .end(pdfBuffer);
    },
  );

  const updatedAppointment = await prisma.appointment.update({
    where: {
      id: appointment.id,
    },
    data: {
      prescriptionUrl: uploadResult.secure_url,
      prescriptionPublicId: uploadResult.public_id,
    },
  });

  const templatePath = path.join(
    process.cwd(),
    "src/app/templates/prescriptionServiceEmailTemplate.ejs",
  );

  const html = await ejs.renderFile(templatePath, prescriptionData);

  await transporter.sendMail({
    from: config.email_sender,
    to: appointment.patient.email,
    subject: "Your Prescription",
    text: "Please find your prescription attached.",
    html,
    attachments: [
      {
        filename: "prescription.pdf",
        content: pdfBuffer,
      },
    ],
  });

  return updatedAppointment;
};

const getSinglePrescription = async (
  appointmentId: string,
  user: RequestUser,
) => {
  const appointment = await prisma.appointment.findUnique({
    where: {
      id: appointmentId,
    },
    include: {
      doctor: {
        select: {
          id: true,
          name: true,
          specialization: true,
          userId: true,
        },
      },
      patient: {
        select: {
          id: true,
          name: true,
          userId: true,
        },
      },
    },
  });
  if (!appointment) {
    throw new AppError(httpStatus.NOT_FOUND, "Appointment not found");
  }

  if (user.role === Role.PATIENT) {
    if (appointment.patient.userId !== user.userId) {
      throw new AppError(
        httpStatus.FORBIDDEN,
        "You are not the owner of this appointment",
        "",
      );
    }
  }
  if (user.role === Role.DOCTOR) {
    if (appointment.doctor.userId !== user.userId) {
      throw new AppError(
        httpStatus.FORBIDDEN,
        "You are not the owner of this appointment",
        "",
      );
    }
  }

  if (!appointment.prescriptionUrl) {
    throw new AppError(
      httpStatus.NOT_FOUND,
      "Prescription not found for this appointment",
      "",
    );
  }

  return {
    appointment,
    prescriptionUrl: appointment.prescriptionUrl,
  };
};

const getAllPrescriptions = async () => {};

export const prescriptionService = {
  createPrescription,
  getAllPrescriptions,
  getSinglePrescription,
};
