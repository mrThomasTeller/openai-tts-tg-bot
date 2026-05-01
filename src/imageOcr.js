import OpenAI from "openai";
import fs from "fs";
import path from "path";
import https from "https";
import { fileURLToPath } from "url";
import config from "./config.js";
import { recordChatUsage } from "./usage.js";

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

function getMimeTypeFromExt(ext) {
  const lower = ext.toLowerCase();
  if (lower === ".png") return "image/png";
  if (lower === ".webp") return "image/webp";
  if (lower === ".gif") return "image/gif";
  return "image/jpeg";
}

export async function recognizeTextFromTelegramImage(ctx, fileId) {
  let tempFilePath;

  try {
    const file = await ctx.telegram.getFile(fileId);
    const ext = path.extname(file.file_path || "") || ".jpg";
    tempFilePath = path.join(tempDir, `image_${Date.now()}_${fileId}${ext}`);
    const fileUrl = `https://api.telegram.org/file/bot${ctx.telegram.token}/${file.file_path}`;

    await downloadFile(fileUrl, tempFilePath);

    const imageBuffer = fs.readFileSync(tempFilePath);
    const base64 = imageBuffer.toString("base64");
    const mimeType = getMimeTypeFromExt(ext);
    const dataUrl = `data:${mimeType};base64,${base64}`;

    const completion = await openai.chat.completions.create({
      model: config.visionModel,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "Ты помощник OCR. Извлеки весь текст с изображения максимально точно, сохраняя структуру (абзацы, списки, переносы строк). " +
            "Не добавляй никаких комментариев, пояснений, заголовков или подписей. " +
            "Если текста на изображении нет, верни пустую строку.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Извлеки текст с этого изображения.",
            },
            {
              type: "image_url",
              image_url: { url: dataUrl },
            },
          ],
        },
      ],
    });

    recordChatUsage(config.visionModel, completion.usage);

    const text = completion.choices?.[0]?.message?.content?.trim() || "";
    return text;
  } catch (error) {
    throw new Error(`Не удалось распознать текст на изображении: ${error.message}`);
  } finally {
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  }
}
