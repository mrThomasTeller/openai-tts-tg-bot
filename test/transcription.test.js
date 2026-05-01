import assert from "node:assert/strict";
import test from "node:test";

import { normalizeTranscriptionText } from "../src/transcription.js";

test("normalizeTranscriptionText trims string responses", () => {
  assert.equal(normalizeTranscriptionText("  привет  "), "привет");
});

test("normalizeTranscriptionText reads text from object responses", () => {
  assert.equal(normalizeTranscriptionText({ text: "  привет  " }), "привет");
});
