import PDFDocument from "pdfkit";
import { IMedicine } from "./prescription.interface";

const PDF_THEME = {
  primary: "#1f4e79",
  mutedText: "#595959",
  tableHeaderText: "#ffffff",
  alternateRow: "#f2f6fa",
  divider: "#d9d9d9",
  text: "#000000",
};

const MEDICINE_TABLE_ROW_PADDING = 6;
const MEDICINE_TABLE_HEADER_HEIGHT = 22;

export interface IPrescriptionPdfData {
  patientName: string;
  patientEmail: string;
  doctorName: string;
  doctorSpecialization: string;
  doctorLicenseNumber: string;
  findings: string;
  medicines: IMedicine[];
}

interface ITableColumn {
  label: string;
  width: number;
}

const getContentBounds = (doc: PDFKit.PDFDocument) => ({
  left: doc.page.margins.left,
  right: doc.page.width - doc.page.margins.right,
});

const drawPrescriptionHeader = (doc: PDFKit.PDFDocument): void => {
  const { left, right } = getContentBounds(doc);

  doc
    .fontSize(22)
    .font("Helvetica-Bold")
    .fillColor(PDF_THEME.primary)
    .text("MEDICAL PRESCRIPTION", { align: "center" });

  doc
    .fontSize(10)
    .font("Helvetica")
    .fillColor(PDF_THEME.mutedText)
    .text(`Issued on ${new Date().toDateString()}`, { align: "center" });

  doc.moveDown(0.6);
  doc
    .moveTo(left, doc.y)
    .lineTo(right, doc.y)
    .lineWidth(1.5)
    .strokeColor(PDF_THEME.primary)
    .stroke();
  doc.moveDown(1);
};

const drawPartyColumn = (
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  label: string,
  lines: string[],
): number => {
  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor(PDF_THEME.mutedText)
    .text(label, x, y, { width });

  let currentY = doc.y + 2;
  lines.forEach((line, index) => {
    doc
      .font(index === 0 ? "Helvetica-Bold" : "Helvetica")
      .fontSize(11)
      .fillColor(PDF_THEME.text)
      .text(line, x, currentY, { width });
    currentY = doc.y;
  });

  return currentY;
};

const drawPartyDetails = (
  doc: PDFKit.PDFDocument,
  data: IPrescriptionPdfData,
): void => {
  const { left, right } = getContentBounds(doc);
  const columnWidth = (right - left) / 2 - 10;
  const topY = doc.y;

  const doctorBottom = drawPartyColumn(
    doc,
    left,
    topY,
    columnWidth,
    "ATTENDING PHYSICIAN",
    [
      `Dr. ${data.doctorName}`,
      data.doctorSpecialization,
      `License No: ${data.doctorLicenseNumber}`,
    ],
  );

  const patientBottom = drawPartyColumn(
    doc,
    left + columnWidth + 20,
    topY,
    columnWidth,
    "PATIENT",
    [data.patientName, data.patientEmail],
  );

  doc.x = left;
  doc.y = Math.max(doctorBottom, patientBottom) + 10;
};

const drawSectionTitle = (doc: PDFKit.PDFDocument, title: string): void => {
  const { left, right } = getContentBounds(doc);

  doc
    .font("Helvetica-Bold")
    .fontSize(12)
    .fillColor(PDF_THEME.primary)
    .text(title, left, doc.y, { width: right - left });

  doc.moveDown(0.3);
  doc
    .moveTo(left, doc.y)
    .lineTo(right, doc.y)
    .lineWidth(1)
    .strokeColor(PDF_THEME.divider)
    .stroke();
  doc.moveDown(0.5);
};

const drawFindingsSection = (
  doc: PDFKit.PDFDocument,
  findings: string,
): void => {
  const { left, right } = getContentBounds(doc);

  drawSectionTitle(doc, "CLINICAL FINDINGS / DIAGNOSIS");
  doc
    .font("Helvetica")
    .fontSize(11)
    .fillColor(PDF_THEME.text)
    .text(findings, left, doc.y, { width: right - left, align: "justify" });
  doc.moveDown(1);
};

const getMedicineTableColumns = (tableWidth: number): ITableColumn[] => {
  const numberColumnWidth = 30;
  const nameColumnWidth = 140;
  const dosageColumnWidth = 80;
  const durationColumnWidth = 80;
  const instructionsColumnWidth =
    tableWidth -
    numberColumnWidth -
    nameColumnWidth -
    dosageColumnWidth -
    durationColumnWidth;

  return [
    { label: "#", width: numberColumnWidth },
    { label: "Medicine", width: nameColumnWidth },
    { label: "Dosage", width: dosageColumnWidth },
    { label: "Duration", width: durationColumnWidth },
    { label: "Instructions", width: instructionsColumnWidth },
  ];
};

const drawMedicineTableHeader = (
  doc: PDFKit.PDFDocument,
  left: number,
  y: number,
  tableWidth: number,
  columns: ITableColumn[],
): void => {
  doc
    .rect(left, y, tableWidth, MEDICINE_TABLE_HEADER_HEIGHT)
    .fill(PDF_THEME.primary);

  let x = left;
  doc.font("Helvetica-Bold").fontSize(10).fillColor(PDF_THEME.tableHeaderText);
  columns.forEach((column) => {
    doc.text(column.label, x + MEDICINE_TABLE_ROW_PADDING, y + 6, {
      width: column.width - MEDICINE_TABLE_ROW_PADDING,
    });
    x += column.width;
  });
};

const getMedicineRowValues = (medicine: IMedicine, index: number): string[] => [
  String(index + 1),
  medicine.name,
  medicine.dosage,
  medicine.duration,
  medicine.instructions ?? "-",
];

const drawMedicineTableRow = (
  doc: PDFKit.PDFDocument,
  left: number,
  y: number,
  tableWidth: number,
  columns: ITableColumn[],
  values: string[],
  isAlternateRow: boolean,
): number => {
  const rowHeight =
    Math.max(
      ...values.map((value, index) =>
        doc.heightOfString(value, {
          width: columns[index].width - MEDICINE_TABLE_ROW_PADDING,
        }),
      ),
    ) +
    MEDICINE_TABLE_ROW_PADDING * 2;

  if (isAlternateRow) {
    doc.rect(left, y, tableWidth, rowHeight).fill(PDF_THEME.alternateRow);
  }

  let x = left;
  doc.font("Helvetica").fontSize(10).fillColor(PDF_THEME.text);
  values.forEach((value, index) => {
    doc.text(
      value,
      x + MEDICINE_TABLE_ROW_PADDING,
      y + MEDICINE_TABLE_ROW_PADDING,
      { width: columns[index].width - MEDICINE_TABLE_ROW_PADDING },
    );
    x += columns[index].width;
  });

  return y + rowHeight;
};

const drawMedicinesTable = (
  doc: PDFKit.PDFDocument,
  medicines: IMedicine[],
): void => {
  const { left, right } = getContentBounds(doc);
  const tableWidth = right - left;
  const columns = getMedicineTableColumns(tableWidth);
  const pageBottom = doc.page.height - doc.page.margins.bottom;

  drawSectionTitle(doc, "PRESCRIBED MEDICINES (Rx)");

  let y = doc.y;
  drawMedicineTableHeader(doc, left, y, tableWidth, columns);
  y += MEDICINE_TABLE_HEADER_HEIGHT;

  medicines.forEach((medicine, index) => {
    if (y > pageBottom - 40) {
      doc.addPage();
      y = doc.page.margins.top;
      drawMedicineTableHeader(doc, left, y, tableWidth, columns);
      y += MEDICINE_TABLE_HEADER_HEIGHT;
    }

    y = drawMedicineTableRow(
      doc,
      left,
      y,
      tableWidth,
      columns,
      getMedicineRowValues(medicine, index),
      index % 2 === 1,
    );
  });

  doc.moveTo(left, y).lineTo(right, y).strokeColor(PDF_THEME.divider).stroke();

  doc.x = left;
  doc.y = y + 20;
};

const drawSignatureFooter = (
  doc: PDFKit.PDFDocument,
  doctorName: string,
  doctorSpecialization: string,
): void => {
  const { left, right } = getContentBounds(doc);
  const signatureWidth = 200;
  const signatureX = right - signatureWidth;
  const footerHeight = 90;

  if (doc.y > doc.page.height - doc.page.margins.bottom - footerHeight) {
    doc.addPage();
  }
  doc.y = doc.page.height - doc.page.margins.bottom - footerHeight;

  doc
    .moveTo(signatureX, doc.y)
    .lineTo(right, doc.y)
    .strokeColor(PDF_THEME.divider)
    .stroke();
  doc.moveDown(0.3);

  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor(PDF_THEME.text)
    .text(`Dr. ${doctorName}`, signatureX, doc.y, {
      width: signatureWidth,
      align: "center",
    });
  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor(PDF_THEME.mutedText)
    .text(doctorSpecialization, signatureX, doc.y, {
      width: signatureWidth,
      align: "center",
    });

  doc.moveDown(1.5);
  doc
    .fontSize(8)
    .fillColor(PDF_THEME.mutedText)
    .text(
      "This is a digitally generated prescription and is valid without a physical signature.",
      left,
      doc.y,
      { width: right - left, align: "center" },
    );
};

export const buildPrescriptionPdf = (
  data: IPrescriptionPdfData,
): Promise<Buffer> => {
  const pdfDocument = new PDFDocument({ margin: 50 });

  const pdfChunks: Buffer[] = [];
  pdfDocument.on("data", (chunk: Buffer) => {
    pdfChunks.push(chunk);
  });

  const pdfReadyPromise = new Promise<Buffer>((resolve) => {
    pdfDocument.on("end", () => {
      resolve(Buffer.concat(pdfChunks));
    });
  });

  drawPrescriptionHeader(pdfDocument);
  drawPartyDetails(pdfDocument, data);
  drawFindingsSection(pdfDocument, data.findings);
  drawMedicinesTable(pdfDocument, data.medicines);
  drawSignatureFooter(pdfDocument, data.doctorName, data.doctorSpecialization);

  pdfDocument.end();

  return pdfReadyPromise;
};
