import { Telegraf } from "telegraf";
import config from "./config.js";
import { splitTextIntoChunks, textToSpeech, cleanupTempFiles } from "./tts.js";
import {
  processDocumentFromTelegram,
  cleanupTempDocuments,
} from "./fileParser.js";
import fs from "fs";

// Create bot instance
const bot = new Telegraf(config.telegramBotToken);

// Message processing queue
const messageQueues = new Map(); // Store queue per user
const processingUsers = new Set(); // Track users currently being processed

// Process messages from queue sequentially
async function processMessageQueue(userId) {
  if (processingUsers.has(userId)) return;

  const queue = messageQueues.get(userId);
  if (!queue || queue.length === 0) {
    messageQueues.delete(userId);
    return;
  }

  processingUsers.add(userId);

  while (queue && queue.length > 0) {
    const { ctx, text, processingMessage } = queue.shift();

    try {
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
        const audioFilePath = await textToSpeech(chunk);

        // Send audio
        await ctx.replyWithVoice({
          source: fs.createReadStream(audioFilePath),
        });

        // Clean up the file after sending
        fs.unlinkSync(audioFilePath);
      }

      // Delete "processing" message after completion
      await ctx.telegram.deleteMessage(
        ctx.chat.id,
        processingMessage.message_id
      );

      // Perform cleanup of any stray temp files
      cleanupTempFiles();
    } catch (error) {
      console.error("Error processing message:", error);
      await ctx.reply(`Произошла ошибка: ${error.message}`);
    }
  }

  processingUsers.delete(userId);
  messageQueues.delete(userId);
}

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

// Handle document messages
bot.on("document", async (ctx) => {
  const userId = ctx.from.id;
  const document = ctx.message.document;

  // Check if file type is supported
  const supportedTypes = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
  ];

  const fileExtension = document.file_name?.split(".").pop()?.toLowerCase();
  const supportedExtensions = ["pdf", "doc", "docx", "txt"];

  if (
    !supportedTypes.includes(document.mime_type) &&
    !supportedExtensions.includes(fileExtension)
  ) {
    return ctx.reply(
      "Неподдерживаемый тип файла. Поддерживаются: PDF, Word (doc, docx), TXT"
    );
  }

  // Check file size (Telegram allows max 20MB for bots)
  if (document.file_size > 20 * 1024 * 1024) {
    return ctx.reply("Файл слишком большой. Максимальный размер: 20 МБ");
  }

  try {
    // Send "processing" message
    const processingMessage = await ctx.reply(
      `Обрабатываю документ "${document.file_name}"...`
    );

    // Extract text from document
    const text = await processDocumentFromTelegram(ctx, document.file_id);

    if (!text || text.trim() === "") {
      await ctx.telegram.deleteMessage(
        ctx.chat.id,
        processingMessage.message_id
      );
      return ctx.reply("Не удалось извлечь текст из документа");
    }

    // Initialize queue for user if not exists
    if (!messageQueues.has(userId)) {
      messageQueues.set(userId, []);
    }

    // Add message to queue
    messageQueues.get(userId).push({
      ctx,
      text,
      processingMessage,
    });

    // Start processing queue for this user
    processMessageQueue(userId);

    // Clean up old temp documents
    cleanupTempDocuments();
  } catch (error) {
    console.error("Error processing document:", error);
    ctx.reply(`Ошибка при обработке документа: ${error.message}`);
  }
});

// Handle text messages
bot.on("text", async (ctx) => {
  const text = ctx.message.text;

  // Ignore commands
  if (text.startsWith("/")) return;

  const userId = ctx.from.id;

  try {
    // Send "processing" message
    const processingMessage = await ctx.reply("Обрабатываю ваш запрос...");

    // Initialize queue for user if not exists
    if (!messageQueues.has(userId)) {
      messageQueues.set(userId, []);
    }

    // Add message to queue
    messageQueues.get(userId).push({
      ctx,
      text,
      processingMessage,
    });

    // Start processing queue for this user
    processMessageQueue(userId);
  } catch (error) {
    console.error("Error queueing message:", error);
    ctx.reply(`Произошла ошибка: ${error.message}`);
  }
});

// Handle errors
bot.catch((err, ctx) => {
  console.error(`Bot error for ${ctx.updateType}`, err);
  ctx.reply("Произошла ошибка в работе бота. Пожалуйста, попробуйте позже.");
});

export default bot;
