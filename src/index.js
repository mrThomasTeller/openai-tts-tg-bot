import bot from "./bot.js";
import config from "./config.js";

// Register session middleware for storing user preferences
bot.use((ctx, next) => {
  // Simple in-memory session
  if (!ctx.session) {
    ctx.session = {};
  }
  return next();
});

// Start the bot
async function startBot() {
  try {
    const botInfo = await bot.telegram.getMe();

    // Don't await - launch() resolves only when bot stops
    bot.launch().catch((err) => {
      console.error("Bot polling error:", err);
      process.exit(1);
    });

    console.log("Bot started successfully!");
    console.log(`Bot: @${botInfo.username}`);
    console.log(`Allowed users: ${config.allowedUsers.join(", ")}`);
    console.log(`TTS model: ${config.ttsModel}`);
    console.log(`Default voice: ${config.ttsVoice}`);
  } catch (err) {
    console.error("Failed to start bot:", err);
    process.exit(1);
  }
}

startBot();

// Enable graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
