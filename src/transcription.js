import OpenAI from "openai";
import fs from "fs";
import path from "path";
import https from "https";
import { fileURLToPath } from "url";
import config from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tempDir = path.resolve(__dirname, "../temp");

if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

const openai = new OpenAI({
  apiKey: config.openaiApiKey,
});

export function normalizeTranscriptionText(transcript) {
  if (typeof transcript === "string") {
    return transcript.trim();
  }

  if (typeof transcript?.text === "string") {
    return transcript.text.trim();
  }

  return "";
}

function downloadFile(url, outputPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outputPath);
    https
      .get(url, (response) => {
        if (response.statusCode && response.statusCode >= 400) {
          fs.unlink(outputPath, () => {});
          reject(
            new Error(`Ошибка скачивания файла: HTTP ${response.statusCode}`)
          );
          return;
        }

        response.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve();
        });
      })
      .on("error", (error) => {
        fs.unlink(outputPath, () => {});
        reject(error);
      });
  });
}

export async function transcribeTelegramAudio(ctx, fileId) {
  let tempFilePath;

  try {
    const file = await ctx.telegram.getFile(fileId);
    const ext = path.extname(file.file_path || "") || ".ogg";
    tempFilePath = path.join(tempDir, `audio_${Date.now()}_${fileId}${ext}`);
    const fileUrl = `https://api.telegram.org/file/bot${ctx.telegram.token}/${file.file_path}`;

    await downloadFile(fileUrl, tempFilePath);

    const transcript = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempFilePath),
      model: config.sttModel,
      response_format: "text",
    });

    return normalizeTranscriptionText(transcript);
  } catch (error) {
    throw new Error(`Не удалось распознать аудио: ${error.message}`);
  } finally {
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  }
}

export async function createSummaryWithEmoji(text) {
  const originalWords = text.trim().split(/\s+/).filter(Boolean).length;
  const targetWords = Math.max(60, Math.round(originalWords / 4.5));

  try {
    const completion = await openai.chat.completions.create({
      model: config.summaryModel,
      temperature: 0.35,
      messages: [
        {
          role: "system",
          content:
            "Ты помощник, который делает содержательную выжимку на русском языке без чрезмерного сжатия. Добавляй уместные emoji. Структура: 1-2 абзаца и затем 5-10 пунктов по сути.",
        },
        {
          role: "user",
          content:
            `Сделай выжимку по тексту так, чтобы сохранить ключевые детали и контекст.\n` +
            `Ориентир по объему: около ${targetWords} слов (допустимо +/- 20%).\n` +
            `Важно: не сжимай слишком сильно, целевой коэффициент сжатия примерно 4-5x.\n\n` +
            `Текст:\n${text}`,
        },
      ],
    });

    return completion.choices?.[0]?.message?.content?.trim() || "";
  } catch (error) {
    throw new Error(`Не удалось создать выжимку: ${error.message}`);
  }
}
