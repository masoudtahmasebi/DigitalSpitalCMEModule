/**
 * Renders the Teilnahmebescheinigung (P8). Infrastructure layer — ADR-0006.
 *
 * Reproduces the ÄKWL Muster: the Veranstalter line, the participant block,
 * the course title, both VNR barcodes side by side, the participation date,
 * the highlighted creditability sentence, the validity clause, and the
 * signature line carrying the Wissenschaftliche Leitung's stamp and signature.
 *
 * ## What this file is not allowed to decide
 *
 * Nothing. Every string with legal weight arrives pre-assembled from
 * `@ds/domain`: the creditability sentence in particular is templated there
 * with the course's own points and category, so no renderer can hardcode
 * "4 Punkten (Kategorie D)" and have it silently drift from an accreditation.
 * This file lays out text and images.
 *
 * ## The two barcodes
 *
 * The Muster shows the VNR twice — Code 39 and Datamatrix — with "Felder bitte
 * nicht überkleben". Both encode exactly the same VNR digits. They are
 * generated from the stored VNR rather than pre-rendered images so that a
 * corrected VNR cannot leave a stale barcode on the page.
 *
 * ## Refusal
 *
 * A certificate missing its stamp or signature is refused rather than rendered
 * without them: the Bescheid makes it invalid without both, and issuing an
 * invalid-looking document to a physician who has earned their points is worse
 * than telling the admin their course is incomplete.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage } from "pdf-lib";
import { toBuffer } from "bwip-js/node";
import { formatBerlinDate, formatBerlinTime } from "@ds/domain";
import type { CertificateData } from "@ds/domain";

/** The signing assets, supplied per course. */
export interface CertificateAssets {
  readonly stampImage: Buffer | null;
  readonly stampImageMime: string | null;
  readonly signatureImage: Buffer | null;
  readonly signatureImageMime: string | null;
  readonly issuePlace: string | null;
}

export class CertificateAssetsMissingError extends Error {
  constructor(readonly missing: readonly string[]) {
    super(`certificate cannot be rendered, missing: ${missing.join(", ")}`);
    this.name = "CertificateAssetsMissingError";
  }
}

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 56;
const RED = rgb(0.85, 0.1, 0.1);
const BLACK = rgb(0, 0, 0);
const HIGHLIGHT = rgb(0.78, 0.78, 0.78);

export async function renderCertificatePdf(
  data: CertificateData,
  assets: CertificateAssets,
): Promise<Uint8Array> {
  const missing: string[] = [];
  if (assets.stampImage === null) missing.push("stampImage");
  if (assets.signatureImage === null) missing.push("signatureImage");
  if (missing.length > 0) throw new CertificateAssetsMissingError(missing);

  const pdf = await PDFDocument.create();
  // Metadata is part of the document: a certificate that says nothing about
  // itself in a PDF reader is harder to file and easier to mistake.
  pdf.setTitle(`Teilnahmebescheinigung – ${data.courseTitle}`);
  pdf.setSubject(`VNR ${data.vnr}`);
  pdf.setProducer("DS Education Platform");
  pdf.setCreationDate(data.completedAt);

  const page = pdf.addPage([A4.width, A4.height]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const contentWidth = A4.width - MARGIN * 2;
  let y = A4.height - MARGIN;

  const centre = (text: string, font: PDFFont, size: number, colour = BLACK) => {
    const width = font.widthOfTextAtSize(text, size);
    page.drawText(text, {
      x: (A4.width - width) / 2,
      y,
      size,
      font,
      color: colour,
    });
  };

  const left = (text: string, font: PDFFont, size: number) => {
    page.drawText(text, { x: MARGIN, y, size, font, color: BLACK });
  };

  centre(data.organizer, regular, 11);
  y -= 30;
  centre("Teilnahmebescheinigung", bold, 20);
  y -= 38;

  left("Hiermit wird bescheinigt, dass", regular, 11);
  y -= 22;
  left("Herr / Frau", regular, 11);
  y -= 22;
  left(`Name / Vorname: ${data.participantName}`, regular, 11);
  y -= 22;
  // Rendered even when empty: the Muster has the line, and a form missing a
  // line it should have looks altered.
  left(`Anschrift: ${data.participantAddress ?? ""}`, regular, 11);
  y -= 40;

  left(`an der Fortbildungsmaßnahme zum Thema: ${data.courseTitle}`, regular, 11);
  y -= 34;

  // ---- The two VNR barcodes, side by side as on the Muster ----------------
  const code39 = await pdf.embedPng(await barcodePng("code39", data.vnr));
  const datamatrix = await pdf.embedPng(await barcodePng("datamatrix", data.vnr));

  const code39Width = contentWidth * 0.62;
  const code39Height = 58;
  const dmSize = 58;

  page.drawText("VNR (Code 39)", {
    x: MARGIN + code39Width / 2 - regular.widthOfTextAtSize("VNR (Code 39)", 10) / 2,
    y,
    size: 10,
    font: regular,
    color: BLACK,
  });
  page.drawText("VNR (Datamatrix, App*):", {
    x: A4.width - MARGIN - dmSize - 60,
    y,
    size: 10,
    font: regular,
    color: BLACK,
  });
  y -= code39Height + 8;

  page.drawImage(code39, {
    x: MARGIN,
    y,
    width: code39Width,
    height: code39Height,
  });
  page.drawImage(datamatrix, {
    x: A4.width - MARGIN - dmSize,
    y,
    width: dmSize,
    height: dmSize,
  });
  y -= 18;

  page.drawText(data.vnr, {
    x: MARGIN + code39Width / 2 - regular.widthOfTextAtSize(data.vnr, 11) / 2,
    y,
    size: 11,
    font: regular,
    color: BLACK,
  });
  y -= 34;

  centre("Felder bitte nicht überkleben", regular, 11, RED);
  y -= 46;

  // ---- Participation date and format --------------------------------------
  // Both -datum and -uhrzeit, which the Bescheid requires. For an on-demand
  // course this is the moment the learner completed it — see the module
  // header in certificate.service.ts.
  left(`am ${formatBerlin(data.completedAt)}`, regular, 11);
  y -= 22;
  left("als on-demand-Webinar", regular, 11);
  y -= 22;
  left("teilgenommen hat.", regular, 11);
  y -= 34;

  // ---- The creditability sentence, highlighted as on the Muster -----------
  const sentenceLines = wrap(data.creditSentence, bold, 11, contentWidth - 16);
  const blockHeight = sentenceLines.length * 15 + 12;

  page.drawRectangle({
    x: MARGIN,
    y: y - blockHeight + 12,
    width: contentWidth,
    height: blockHeight,
    color: HIGHLIGHT,
  });

  for (const line of sentenceLines) {
    const width = bold.widthOfTextAtSize(line, 11);
    page.drawText(line, {
      x: (A4.width - width) / 2,
      y,
      size: 11,
      font: bold,
      color: BLACK,
    });
    y -= 15;
  }
  y -= 24;

  for (const line of wrap(
    "Diese Bescheinigung ist nur vollständig ausgefüllt und mit Originalstempel " +
      "des ärztlichen Antragstellenden oder der ärztlichen Leitung der " +
      "Fortbildungsmaßnahme gültig.",
    regular,
    11,
    contentWidth,
  )) {
    const width = regular.widthOfTextAtSize(line, 11);
    page.drawText(line, { x: (A4.width - width) / 2, y, size: 11, font: regular });
    y -= 15;
  }

  // ---- Signature block ----------------------------------------------------
  const signatureBlockY = MARGIN + 96;

  const stamp = await embed(pdf, assets.stampImage!, assets.stampImageMime);
  const signature = await embed(pdf, assets.signatureImage!, assets.signatureImageMime);

  const stampBox = fit(stamp, 120, 70);
  page.drawImage(stamp, {
    x: A4.width - MARGIN - stampBox.width,
    y: signatureBlockY,
    width: stampBox.width,
    height: stampBox.height,
  });

  const signatureBox = fit(signature, 150, 50);
  page.drawImage(signature, {
    x: MARGIN + 110,
    y: signatureBlockY + 6,
    width: signatureBox.width,
    height: signatureBox.height,
  });

  page.drawText(
    `${assets.issuePlace ?? data.eventLocation}, ${formatBerlinDate(data.completedAt)}`,
    { x: MARGIN, y: signatureBlockY + 20, size: 10, font: regular, color: BLACK },
  );

  page.drawLine({
    start: { x: MARGIN, y: signatureBlockY - 10 },
    end: { x: A4.width - MARGIN, y: signatureBlockY - 10 },
    thickness: 0.75,
    color: BLACK,
  });

  const footer =
    "Ort, Datum, Unterschrift / Stempel des ärztl. Antragstellenden/ Veranstaltungsleitenden";
  page.drawText(footer, {
    x: (A4.width - regular.widthOfTextAtSize(footer, 9)) / 2,
    y: signatureBlockY - 24,
    size: 9,
    font: regular,
    color: BLACK,
  });

  const lead = data.scientificLeadName;
  page.drawText(lead, {
    x: (A4.width - regular.widthOfTextAtSize(lead, 9)) / 2,
    y: signatureBlockY - 38,
    size: 9,
    font: regular,
    color: BLACK,
  });

  return pdf.save();
}

/**
 * Both barcodes encode the VNR digits and nothing else.
 *
 * `includetext: false` because the Muster prints the digits itself, centred
 * under the Code 39 — duplicating them inside the symbol would not match.
 */
async function barcodePng(
  type: "code39" | "datamatrix",
  vnr: string,
): Promise<Uint8Array> {
  const png = await toBuffer({
    bcid: type,
    text: vnr,
    scale: 3,
    // Only the linear symbol takes a height; a Datamatrix is square and sizes
    // itself from `scale`, and passing a height at all makes it error.
    ...(type === "code39" ? { height: 12 } : {}),
    includetext: false,
    paddingwidth: 0,
    paddingheight: 0,
  });
  return new Uint8Array(png);
}

async function embed(
  pdf: PDFDocument,
  bytes: Buffer,
  mime: string | null,
): Promise<PDFImage> {
  const image = standalone(bytes);

  // The column constraint permits only PNG and JPEG, so this covers both. The
  // sniff is a fallback for a row written before that constraint existed.
  if (mime === "image/jpeg") return pdf.embedJpg(image);
  if (mime === "image/png") return pdf.embedPng(image);
  return isPng(bytes) ? pdf.embedPng(image) : pdf.embedJpg(image);
}

/**
 * Copy into an array that owns its buffer from offset zero.
 *
 * Node pools small Buffers, so `Buffer.from(...)` — and everything `pg`
 * returns for a `bytea` column — is usually a *view* into a shared 8 KB
 * ArrayBuffer at a non-zero `byteOffset`. pdf-lib's image embedders do
 * `new DataView(imageData.buffer)`, which ignores that offset and reads from
 * the start of the pool: the bytes it inspects are whatever was allocated
 * before ours. The symptom is "SOI not found in JPEG" on a perfectly valid
 * image, and whether it happens depends on allocation history — so it can pass
 * locally and fail in production, or the reverse.
 *
 * Since the stamp arrives from Postgres as exactly such a pooled Buffer, this
 * copy is not defensive tidiness; without it certificate rendering is a
 * coin flip.
 */
function standalone(bytes: Buffer): Uint8Array {
  return new Uint8Array(bytes);
}

function isPng(bytes: Buffer): boolean {
  return (
    bytes.length > 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  );
}

/** Scale to fit a box without distorting the stamp's aspect ratio. */
function fit(
  image: PDFImage,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
  return { width: image.width * scale, height: image.height * scale };
}

/** Greedy word wrap. Long enough for the two sentences this document has. */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line === "" ? word : `${line} ${word}`;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && line !== "") {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}

/**
 * German local time, which is a presentation concern only — everything is
 * stored UTC (`CLAUDE.md` §5). A certificate read in Germany showing a UTC
 * timestamp would be wrong by an hour or two in the reader's eyes, and a
 * certificate read from Vienna must still show the German day, because that is
 * the day reported to the Ärztekammer.
 *
 * Both formatters come from `@ds/domain` so the PDF, the CSV export, the admin
 * list and the widget cannot disagree about what day an instant was.
 */
function formatBerlin(at: Date): string {
  return `${formatBerlinDate(at)} um ${formatBerlinTime(at)}`;
}
