import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

// Validate required environment variables
const requiredEnvVars = [
  "TELEGRAM_BOT_TOKEN",
  "OPENAI_API_KEY",
  "ALLOWED_USERS",
];
const missingEnvVars = requiredEnvVars.filter((envVar) => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  throw new Error(
    `Missing required environment variables: ${missingEnvVars.join(", ")}`
  );
}

// Parse allowed users
const allowedUsers = process.env.ALLOWED_USERS.split(",").map((user) =>
  user.trim()
);

export default {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  openaiApiKey: process.env.OPENAI_API_KEY,
  allowedUsers,
  ttsModel: process.env.TTS_MODEL || "gpt-4o-mini-tts",
  ttsVoice: process.env.TTS_VOICE || "cedar",
  sttModel: process.env.STT_MODEL || "gpt-4o-mini-transcribe",
  summaryModel: process.env.SUMMARY_MODEL || "gpt-5.4-mini",
  visionModel: process.env.VISION_MODEL || "gpt-5.4-mini",
  maxTextLength: parseInt(process.env.MAX_TEXT_LENGTH || "4096", 10),
  audioBatchWindowMs: parseInt(process.env.AUDIO_BATCH_WINDOW_MS || "2000", 10),
  imageBatchWindowMs: parseInt(process.env.IMAGE_BATCH_WINDOW_MS || "2000", 10),
};
