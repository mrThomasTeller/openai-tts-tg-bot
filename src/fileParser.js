import fs from "fs";
import path from "path";
import mammoth from "mammoth";
import { promisify } from "util";
import https from "https";
import { Readable } from "stream";

const readFile = promisify(fs.readFile);

// Download file from Telegram
async function downloadFile(fileUrl, filePath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filePath);
    https.get(fileUrl, (response) => {
      response.pipe(file);
      file.on("finish", () => {
        file.close();
        resolve();
      });
    }).on("error", (err) => {
      fs.unlink(filePath, () => {}); // Delete the file on error
      reject(err);
    });
  });
}

// Extract text from PDF
async function extractTextFromPDF(buffer) {
  try {
    // Dynamic import to avoid initialization issues in Docker
    const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default;
    const data = await pdfParse(buffer);
    return data.text;
  } catch (error) {
    console.error("Error parsing PDF:", error);
    throw new Error("Не удалось извлечь текст из PDF файла");
  }
}

// Extract text from Word document
async function extractTextFromWord(buffer) {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } catch (error) {
    console.error("Error parsing Word document:", error);
    throw new Error("Не удалось извлечь текст из Word документа");
  }
}

// Extract text from TXT file
function extractTextFromTxt(buffer) {
  return buffer.toString("utf-8");
}

// Main function to extract text from file
export async function extractTextFromFile(filePath, mimeType) {
  const buffer = await readFile(filePath);

  // Determine file type from extension if mime type is not provided
  const ext = path.extname(filePath).toLowerCase();

  if (mimeType?.includes("pdf") || ext === ".pdf") {
    return await extractTextFromPDF(buffer);
  } else if (
    mimeType?.includes("word") ||
    mimeType?.includes("document") ||
    ext === ".docx" ||
    ext === ".doc"
  ) {
    return await extractTextFromWord(buffer);
  } else if (
    mimeType?.includes("text") ||
    ext === ".txt"
  ) {
    return extractTextFromTxt(buffer);
  } else {
    throw new Error(`Неподдерживаемый тип файла: ${mimeType || ext}`);
  }
}

// Download and extract text from Telegram file
export async function processDocumentFromTelegram(ctx, fileId) {
  const tempDir = path.join(process.cwd(), "temp");

  // Create temp directory if it doesn't exist
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  try {
    // Get file info from Telegram
    const file = await ctx.telegram.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${ctx.telegram.token}/${file.file_path}`;

    // Generate temp file path
    const fileName = path.basename(file.file_path);
    const tempFilePath = path.join(tempDir, `${Date.now()}_${fileName}`);

    // Download file
    await downloadFile(fileUrl, tempFilePath);

    // Extract text from file
    const text = await extractTextFromFile(tempFilePath, file.mime_type);

    // Clean up temp file
    fs.unlinkSync(tempFilePath);

    return text;
  } catch (error) {
    console.error("Error processing document:", error);
    throw error;
  }
}

// Clean up old temp files
export function cleanupTempDocuments() {
  const tempDir = path.join(process.cwd(), "temp");

  if (!fs.existsSync(tempDir)) return;

  const files = fs.readdirSync(tempDir);
  const now = Date.now();
  const maxAge = 60 * 60 * 1000; // 1 hour

  files.forEach(file => {
    const filePath = path.join(tempDir, file);
    const stats = fs.statSync(filePath);

    if (now - stats.mtimeMs > maxAge) {
      fs.unlinkSync(filePath);
    }
  });
}