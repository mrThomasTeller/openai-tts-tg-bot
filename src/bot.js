import { Telegraf } from "telegraf";
import config from "./config.js";
import tts, {
  splitTextIntoChunks,
  textToSpeech,
  cleanupTempFiles,
} from "./tts.js";
import fs from "fs";

// Create bot instance
const bot = new Telegraf(config.telegramBotToken);

// Check if user is allowed to use the bot
function isUserAllowed(ctx) {
  const userId = ctx.from?.id?.toString();
  const username = ctx.from?.username ? `@${ctx.from.username}` : null;

  return config.allowedUsers.some((allowedUser) => {
    // Check if it's a numeric ID or a username with @
    if (allowedUser.startsWith("@")) {
      return allowedUser === username;
    } else {
      return allowedUser === userId;
    }
  });
}

// Set up middleware to check user access
bot.use((ctx, next) => {
  if (!isUserAllowed(ctx)) {
    console.log(
      `Unauthorized access attempt by user ${ctx.from?.id} (@${ctx.from?.username})`
    );
    return ctx.reply("Извините, у вас нет доступа к этому боту.");
  }
  return next();
});

// Handle start command
bot.start((ctx) => {
  ctx.reply(
    "Привет! Я бот для преобразования текста в речь. " +
      "Отправьте мне текст, и я верну его в виде аудио сообщения. " +
      "Для больших текстов я разделю их на части и отправлю несколько аудио сообщений."
  );
});

// Handle help command
bot.help((ctx) => {
  ctx.reply(
    "Чтобы использовать бота, просто отправьте текст, и я преобразую его в аудио сообщение.\n\n" +
      "Доступные команды:\n" +
      "/start - Начать работу с ботом\n" +
      "/help - Показать эту справку\n" +
      "/voice [название голоса] - Изменить голос (доступны: alloy, echo, fable, onyx, nova, shimmer)"
  );
});

// Handle voice change command
bot.command("voice", async (ctx) => {
  const args = ctx.message.text.split(" ");
  if (args.length < 2) {
    return ctx.reply(
      "Пожалуйста, укажите название голоса.\n" +
        "Доступные голоса: alloy, echo, fable, onyx, nova, shimmer\n" +
        "Пример: /voice nova"
    );
  }

  const voice = args[1].toLowerCase();
  const availableVoices = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];

  if (!availableVoices.includes(voice)) {
    return ctx.reply(
      `Неизвестный голос: ${voice}.\n` +
        "Доступные голоса: alloy, echo, fable, onyx, nova, shimmer"
    );
  }

  // Store voice preference (for a real app, you'd save this to a database)
  ctx.session = ctx.session || {};
  ctx.session.voice = voice;

  return ctx.reply(`Голос изменен на ${voice}.`);
});

// Handle text messages
bot.on("text", async (ctx) => {
  const text = ctx.message.text;

  // Ignore commands
  if (text.startsWith("/")) return;

  try {
    // Send "processing" message
    const processingMessage = await ctx.reply("Обрабатываю ваш запрос...");

    // Split text into chunks if needed
    const chunks = splitTextIntoChunks(text, config.maxTextLength);

    // Convert each chunk to speech
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      // Add "processing chunk" message if multiple chunks
      if (chunks.length > 1) {
        await ctx.reply(`Обрабатываю часть ${i + 1} из ${chunks.length}...`);
      }

      // Convert to speech
      const voice = ctx.session?.voice || config.ttsVoice;
      const audioFilePath = await textToSpeech(chunk);

      // Send audio
      await ctx.replyWithVoice({
        source: fs.createReadStream(audioFilePath),
      });

      // Clean up the file after sending
      fs.unlinkSync(audioFilePath);
    }

    // Delete "processing" message after completion
    await ctx.telegram.deleteMessage(ctx.chat.id, processingMessage.message_id);

    // Perform cleanup of any stray temp files
    cleanupTempFiles();
  } catch (error) {
    console.error("Error processing message:", error);
    ctx.reply(`Произошла ошибка: ${error.message}`);
  }
});

// Handle errors
bot.catch((err, ctx) => {
  console.error(`Bot error for ${ctx.updateType}`, err);
  ctx.reply("Произошла ошибка в работе бота. Пожалуйста, попробуйте позже.");
});

export default bot;
