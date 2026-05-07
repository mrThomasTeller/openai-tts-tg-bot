import { Telegraf } from "telegraf";
import config from "./config.js";
import { splitTextIntoChunks, textToSpeech, cleanupTempFiles } from "./tts.js";
import {
  processDocumentFromTelegram,
  cleanupTempDocuments,
} from "./fileParser.js";
import {
  transcribeTelegramAudio,
  createSummaryWithEmoji,
} from "./transcription.js";
import { recognizeTextFromTelegramImage } from "./imageOcr.js";
import { getStatsReport } from "./usage.js";
import fs from "fs";
import os from "os";
import path from "path";

// Create bot instance
const bot = new Telegraf(config.telegramBotToken);

// Message processing queue
const messageQueues = new Map(); // Store queue per user
const processingUsers = new Set(); // Track users currently being processed
const audioBatchStates = new Map(); // Store pending audio messages per user
const imageBatchStates = new Map(); // Store pending image messages per user

async function upsertStatusMessage(state, text) {
  if (!state.statusMessage) {
    state.statusMessage = await state.chatCtx.reply(text);
    return;
  }

  try {
    await state.chatCtx.telegram.editMessageText(
      state.chatId,
      state.statusMessage.message_id,
      undefined,
      text
    );
  } catch (error) {
    if (!error.message?.includes("message is not modified")) {
      state.statusMessage = await state.chatCtx.reply(text);
    }
  }
}

async function processAudioBatch(userId) {
  const state = audioBatchStates.get(userId);
  if (!state || state.processing) return;

  const batch = state.items.splice(0, state.items.length);
  if (batch.length === 0) return;

  state.processing = true;

  try {
    await upsertStatusMessage(
      state,
      `🎧 Начал обработку аудио (${batch.length} шт.)`
    );

    const transcriptParts = [];
    for (let i = 0; i < batch.length; i++) {
      const item = batch[i];
      await upsertStatusMessage(
        state,
        `📝 Транскрибация ${i + 1}/${batch.length}...`
      );

      const transcript = await transcribeTelegramAudio(item.ctx, item.fileId);
      if (transcript) {
        transcriptParts.push(transcript);
      }
    }

    const mergedTranscript = transcriptParts.join("\n\n").trim();
    if (!mergedTranscript) {
      await upsertStatusMessage(
        state,
        "⚠️ Не удалось распознать текст в аудио."
      );
      return;
    }

    const txtPath = path.join(os.tmpdir(), `transcript_${Date.now()}.txt`);
    fs.writeFileSync(txtPath, mergedTranscript, "utf-8");
    console.log(`[doc] sending, size: ${fs.statSync(txtPath).size}`);
    try {
      await state.chatCtx.replyWithDocument({
        source: fs.createReadStream(txtPath),
        filename: path.basename(txtPath),
      });
      console.log("[doc] sent ok");
    } catch (docError) {
      console.error("[doc] failed:", docError.message);
    } finally {
      fs.unlinkSync(txtPath);
    }
    console.log("[text] sending text");
    for (let i = 0; i < mergedTranscript.length; i += 4096) {
      await state.chatCtx.reply(mergedTranscript.slice(i, i + 4096));
    }
    console.log("[text] sent ok");

    await upsertStatusMessage(state, "✨ Формирую краткую выжимку...");
    const summary = await createSummaryWithEmoji(mergedTranscript);

    await upsertStatusMessage(state, "✅ Готово!");

    if (summary) {
      await state.chatCtx.reply(`✨ Выжимка:\n${summary}`);
    }
  } catch (error) {
    console.error("Error processing audio batch:", error);
    await state.chatCtx.reply(`Ошибка при обработке аудио: ${error.message}`);
  } finally {
    state.processing = false;

    if (state.items.length > 0) {
      state.timer = setTimeout(() => {
        processAudioBatch(userId);
      }, config.audioBatchWindowMs);
    } else {
      if (state.timer) {
        clearTimeout(state.timer);
      }
      audioBatchStates.delete(userId);
    }
  }
}

function enqueueAudioMessage(ctx, fileId) {
  const userId = ctx.from.id;
  let state = audioBatchStates.get(userId);

  if (!state) {
    state = {
      chatCtx: ctx,
      chatId: ctx.chat.id,
      items: [],
      timer: null,
      processing: false,
      statusMessage: null,
    };
    audioBatchStates.set(userId, state);
  }

  state.chatCtx = ctx;
  state.chatId = ctx.chat.id;
  state.items.push({ ctx, fileId });

  if (state.timer) {
    clearTimeout(state.timer);
  }

  upsertStatusMessage(
    state,
    `⏳ Получил аудио (${state.items.length}). Жду еще сообщения для общей выжимки...`
  ).catch((error) => {
    console.error("Error updating status message:", error);
  });

  state.timer = setTimeout(() => {
    processAudioBatch(userId);
  }, config.audioBatchWindowMs);
}

async function processImageBatch(userId) {
  const state = imageBatchStates.get(userId);
  if (!state || state.processing) return;

  const batch = state.items.splice(0, state.items.length);
  if (batch.length === 0) return;

  state.processing = true;

  try {
    await upsertStatusMessage(
      state,
      `🖼️ Начал обработку изображений (${batch.length} шт.)`
    );

    for (let i = 0; i < batch.length; i++) {
      const item = batch[i];

      await upsertStatusMessage(
        state,
        `🔍 Распознаю текст ${i + 1}/${batch.length}...`
      );

      let recognizedText;
      try {
        recognizedText = await recognizeTextFromTelegramImage(
          item.ctx,
          item.fileId
        );
      } catch (error) {
        console.error("Error recognizing image text:", error);
        await item.ctx.reply(
          `⚠️ Не удалось распознать текст на изображении ${i + 1}: ${
            error.message
          }`,
          { reply_to_message_id: item.messageId }
        );
        continue;
      }

      if (!recognizedText || recognizedText.trim() === "") {
        await item.ctx.reply(`⚠️ Текст на изображении ${i + 1} не найден.`, {
          reply_to_message_id: item.messageId,
        });
        continue;
      }

      await upsertStatusMessage(
        state,
        `🎙️ Озвучиваю ${i + 1}/${batch.length}...`
      );

      const chunks = splitTextIntoChunks(recognizedText, config.maxTextLength);

      for (const chunk of chunks) {
        const audioFilePath = await textToSpeech(chunk);
        try {
          await item.ctx.replyWithVoice(
            { source: fs.createReadStream(audioFilePath) },
            { reply_to_message_id: item.messageId }
          );
        } finally {
          if (fs.existsSync(audioFilePath)) {
            fs.unlinkSync(audioFilePath);
          }
        }
      }
    }

    await upsertStatusMessage(state, "✅ Готово!");
    cleanupTempFiles();
  } catch (error) {
    console.error("Error processing image batch:", error);
    await state.chatCtx.reply(
      `Ошибка при обработке изображений: ${error.message}`
    );
  } finally {
    state.processing = false;

    if (state.items.length > 0) {
      state.timer = setTimeout(() => {
        processImageBatch(userId);
      }, config.imageBatchWindowMs);
    } else {
      if (state.timer) {
        clearTimeout(state.timer);
      }
      imageBatchStates.delete(userId);
    }
  }
}

function enqueueImageMessage(ctx, fileId, messageId) {
  const userId = ctx.from.id;
  let state = imageBatchStates.get(userId);

  if (!state) {
    state = {
      chatCtx: ctx,
      chatId: ctx.chat.id,
      items: [],
      timer: null,
      processing: false,
      statusMessage: null,
    };
    imageBatchStates.set(userId, state);
  }

  state.chatCtx = ctx;
  state.chatId = ctx.chat.id;
  state.items.push({ ctx, fileId, messageId });

  if (state.timer) {
    clearTimeout(state.timer);
  }

  upsertStatusMessage(
    state,
    `⏳ Получил изображение (${state.items.length}). Жду еще...`
  ).catch((error) => {
    console.error("Error updating status message:", error);
  });

  state.timer = setTimeout(() => {
    processImageBatch(userId);
  }, config.imageBatchWindowMs);
}

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
    const { ctx, text, processingMessage, fileName } = queue.shift();

    try {
      // Split text into chunks if needed
      const chunks = splitTextIntoChunks(text, config.maxTextLength);

      // Delete initial "processing" message
      await ctx.telegram.deleteMessage(
        ctx.chat.id,
        processingMessage.message_id
      );

      // Show file name if provided (for documents)
      if (fileName) {
        await ctx.reply(fileName);
      }

      // Convert each chunk to speech and send immediately
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];

        // Show "processing chunk" message if multiple chunks
        let chunkMessage = null;
        if (chunks.length > 1) {
          chunkMessage = await ctx.reply(
            `Обрабатываю часть ${i + 1} из ${chunks.length}...`
          );
        }

        // Convert to speech
        const audioFilePath = await textToSpeech(chunk);

        // Send audio
        await ctx.replyWithVoice({
          source: fs.createReadStream(audioFilePath),
        });

        // Clean up the file after sending
        fs.unlinkSync(audioFilePath);

        // Delete "processing chunk" message after audio is sent
        if (chunkMessage) {
          await ctx.telegram.deleteMessage(
            ctx.chat.id,
            chunkMessage.message_id
          );
        }
      }

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
      "/voice [название голоса] - Изменить голос (доступны: alloy, ash, ballad, coral, echo, fable, marin, nova, onyx, sage, shimmer, verse, cedar)\n" +
      "/stats - Показать расходы на OpenAI\n\n" +
      "Также поддерживаются голосовые и аудиофайлы: бот сделает х и краткую выжимку."
  );
});

// Handle voice change command
bot.command("voice", async (ctx) => {
  const args = ctx.message.text.split(" ");
  if (args.length < 2) {
    return ctx.reply(
      "Пожалуйста, укажите название голоса.\n" +
        "Доступные голоса: alloy, ash, ballad, coral, echo, fable, marin, nova, onyx, sage, shimmer, verse, cedar\n" +
        "Пример: /voice cedar"
    );
  }

  const voice = args[1].toLowerCase();
  const availableVoices = [
    "alloy",
    "ash",
    "ballad",
    "coral",
    "echo",
    "fable",
    "marin",
    "nova",
    "onyx",
    "sage",
    "shimmer",
    "verse",
    "cedar",
  ];

  if (!availableVoices.includes(voice)) {
    return ctx.reply(
      `Неизвестный голос: ${voice}.\n` +
        `Доступные голоса: ${availableVoices.join(", ")}`
    );
  }

  // Store voice preference (for a real app, you'd save this to a database)
  ctx.session = ctx.session || {};
  ctx.session.voice = voice;

  return ctx.reply(`Голос изменен на ${voice}.`);
});

// Handle stats command
bot.command("stats", async (ctx) => {
  try {
    await ctx.reply(getStatsReport());
  } catch (error) {
    console.error("Error getting stats:", error);
    await ctx.reply(`Не удалось получить статистику: ${error.message}`);
  }
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
  const audioExtensions = ["mp3", "wav", "m4a", "ogg", "oga", "flac", "aac"];

  if (
    document.mime_type?.startsWith("audio/") ||
    audioExtensions.includes(fileExtension)
  ) {
    enqueueAudioMessage(ctx, document.file_id);
    return;
  }

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

    // Add message to queue with file name
    messageQueues.get(userId).push({
      ctx,
      text,
      processingMessage,
      fileName: document.file_name,
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

// Handle Telegram voice messages
bot.on("voice", async (ctx) => {
  enqueueAudioMessage(ctx, ctx.message.voice.file_id);
});

// Handle Telegram audio messages
bot.on("audio", async (ctx) => {
  enqueueAudioMessage(ctx, ctx.message.audio.file_id);
});

// Handle Telegram photo messages
bot.on("photo", async (ctx) => {
  const photos = ctx.message.photo;
  if (!photos || photos.length === 0) return;

  // Telegram sends multiple sizes — pick the largest
  const largest = photos[photos.length - 1];
  enqueueImageMessage(ctx, largest.file_id, ctx.message.message_id);
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
