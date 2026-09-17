import PDFDocument from "pdfkit";

export interface IAppointmentConfirmationPdfData {
  patientName: string;
  patientEmail: string;
  doctorName: string;
  doctorEmail: string;
  scheduleDate: string;
  joiningTime: Date | null;
  serialNumber: number | null;
  meetingLink: string;
  amount: string;
  transactionID: string;
  paidAt: string;
}

export const buildAppointmentConfirmationPdf = (
  data: IAppointmentConfirmationPdfData,
): Promise<Buffer> => {
  const pdfDocument = new PDFDocument({
    margin: 50,
  });

  const pdfChunks: Buffer[] = [];
  pdfDocument.on("data", (chunk: Buffer) => {
    pdfChunks.push(chunk);
  });

  const pdfReadyPromise = new Promise<Buffer>((resolve, reject) => {
    pdfDocument.on("end", () => {
      const pdfBuffer = Buffer.concat(pdfChunks);
      resolve(pdfBuffer);
    });
  });

  pdfDocument
    .fontSize(20)
    .text("Appointment Confirmation", { align: "center" });
  pdfDocument.moveDown();
  pdfDocument.fontSize(14).text(`Patient Name: ${data.patientName}`);
  pdfDocument.fontSize(14).text(`Patient Email: ${data.patientEmail}`);

  pdfDocument.moveDown(2);

  pdfDocument.fontSize(14).text(`Doctor Name: ${data.doctorName}`);
  pdfDocument.fontSize(14).text(`Doctor Email: ${data.doctorEmail}`);

  pdfDocument.moveDown(2);
  pdfDocument.text(`Schedule Date: ${data.scheduleDate}`);

  pdfDocument.moveDown(2);
  pdfDocument.text(`Joining Time: ${data.joiningTime}`);
  pdfDocument.text(`Serial Number: ${data.serialNumber}`);
  pdfDocument.text(`Meeting Link: ${data.meetingLink}`);

  pdfDocument.moveDown();
  pdfDocument.text(`Amount Paid: ${data.amount} BDT`);
  pdfDocument.text(`Payment Method: bKash`);
  pdfDocument.text(`Transaction ID: ${data.transactionID}`);
  pdfDocument.text(`Paid At: ${data.paidAt}`);

  pdfDocument.end();

  return pdfReadyPromise;
};
