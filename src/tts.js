import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import config from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tempDir = path.resolve(__dirname, "../temp");

// Ensure temp directory exists
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: config.openaiApiKey,
});

/**
 * Split text into chunks of maximum size
 * @param {string} text - The text to split
 * @param {number} maxLength - Maximum length of each chunk
 * @returns {string[]} Array of text chunks
 */
export function splitTextIntoChunks(text, maxLength = config.maxTextLength) {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks = [];
  let currentIndex = 0;

  while (currentIndex < text.length) {
    // Find a good breaking point near the maxLength
    let endIndex = Math.min(currentIndex + maxLength, text.length);

    // If we're not at the end of the text, try to find a natural break
    if (endIndex < text.length) {
      // Try to find sentence breaks (., !, ?)
      const sentenceBreakIndex = text.lastIndexOf(".", endIndex);
      const exclamationBreakIndex = text.lastIndexOf("!", endIndex);
      const questionBreakIndex = text.lastIndexOf("?", endIndex);

      // Find the closest break point that's not too far back
      const breakPoints = [
        sentenceBreakIndex,
        exclamationBreakIndex,
        questionBreakIndex,
      ].filter((index) => index > currentIndex && index <= endIndex - 10);

      if (breakPoints.length > 0) {
        endIndex = Math.max(...breakPoints) + 1; // Include the punctuation
      } else {
        // If no sentence breaks, try to break at spaces
        const spaceIndex = text.lastIndexOf(" ", endIndex);
        if (spaceIndex > currentIndex && spaceIndex > endIndex - 50) {
          endIndex = spaceIndex;
        }
      }
    }

    chunks.push(text.substring(currentIndex, endIndex).trim());
    currentIndex = endIndex;
  }

  return chunks;
}

/**
 * Convert text to speech using OpenAI API
 * @param {string} text - The text to convert to speech
 * @returns {Promise<string>} Path to the generated audio file
 */
export async function textToSpeech(text) {
  try {
    const timestamp = Date.now();
    const outputPath = path.join(tempDir, `speech_${timestamp}.mp3`);

    const mp3 = await openai.audio.speech.create({
      model: config.ttsModel,
      voice: config.ttsVoice,
      input: text,
    });

    const buffer = Buffer.from(await mp3.arrayBuffer());
    fs.writeFileSync(outputPath, buffer);

    return outputPath;
  } catch (error) {
    console.error("Error in TTS conversion:", error);
    throw new Error(`Failed to convert text to speech: ${error.message}`);
  }
}

/**
 * Clean up temporary files older than a certain time
 * @param {number} maxAgeMs - Maximum age in milliseconds
 */
export function cleanupTempFiles(maxAgeMs = 3600000) {
  // Default: 1 hour
  const now = Date.now();

  try {
    const files = fs.readdirSync(tempDir);
    for (const file of files) {
      const filePath = path.join(tempDir, file);
      const stats = fs.statSync(filePath);

      if (now - stats.mtimeMs > maxAgeMs) {
        fs.unlinkSync(filePath);
      }
    }
  } catch (error) {
    console.error("Error cleaning up temp files:", error);
  }
}

// Export functions
export default {
  textToSpeech,
  splitTextIntoChunks,
  cleanupTempFiles,
};
