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
  ttsModel: process.env.TTS_MODEL || "tts-1",
  ttsVoice: process.env.TTS_VOICE || "alloy",
  maxTextLength: parseInt(process.env.MAX_TEXT_LENGTH || "4096", 10),
};
