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

    return typeof transcript === "string" ? transcript.trim() : "";
  } catch (error) {
    throw new Error(`Не удалось распознать аудио: ${error.message}`);
  } finally {
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  }
}

export async function createSummaryWithEmoji(text) {
  try {
    const completion = await openai.chat.completions.create({
      model: config.summaryModel,
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content:
            "Ты помощник, который делает очень краткую, понятную выжимку на русском языке. Добавляй уместные emoji. Формат: 3-6 коротких пунктов.",
        },
        {
          role: "user",
          content: `Сделай краткую выжимку по этому тексту:\n\n${text}`,
        },
      ],
    });

    return completion.choices?.[0]?.message?.content?.trim() || "";
  } catch (error) {
    throw new Error(`Не удалось создать выжимку: ${error.message}`);
  }
}

