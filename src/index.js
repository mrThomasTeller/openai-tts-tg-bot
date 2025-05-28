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
bot
  .launch()
  .then(() => {
    console.log("Bot started successfully!");
    console.log(`Allowed users: ${config.allowedUsers.join(", ")}`);
    console.log(`TTS model: ${config.ttsModel}`);
    console.log(`Default voice: ${config.ttsVoice}`);
  })
  .catch((err) => {
    console.error("Failed to start bot:", err);
    process.exit(1);
  });

// Enable graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
