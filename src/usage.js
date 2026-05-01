import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, "../data");
const dataFile = path.join(dataDir, "usage.json");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Цены в USD. Источники указаны рядом со значениями (на 2026-05).
// chat: за 1M токенов; tts: input — за 1M текстовых токенов, output — за 1M аудио-токенов;
// stt: за 1 минуту аудио.
const PRICES = {
  chat: {
    "gpt-5.4-mini": { input: 0.75, cachedInput: 0.075, output: 4.5 },
    "gpt-5-mini": { input: 0.25, cachedInput: 0.025, output: 2.0 },
    "gpt-5.4": { input: 1.25, cachedInput: 0.125, output: 10.0 },
    "gpt-4o-mini": { input: 0.15, cachedInput: 0.075, output: 0.6 },
    "gpt-4o": { input: 2.5, cachedInput: 1.25, output: 10.0 },
  },
  tts: {
    "gpt-4o-mini-tts": { input: 0.6, output: 12.0 },
  },
  stt: {
    "gpt-4o-mini-transcribe": { perMinute: 0.003 },
    "gpt-4o-transcribe": { perMinute: 0.006 },
    "whisper-1": { perMinute: 0.006 },
  },
};

function loadStore() {
  try {
    if (!fs.existsSync(dataFile)) {
      return { totals: emptyTotals(), byDay: {}, byModel: {} };
    }
    const raw = fs.readFileSync(dataFile, "utf8");
    const parsed = JSON.parse(raw);
    return {
      totals: parsed.totals || emptyTotals(),
      byDay: parsed.byDay || {},
      byModel: parsed.byModel || {},
    };
  } catch (error) {
    console.error("Error reading usage store:", error);
    return { totals: emptyTotals(), byDay: {}, byModel: {} };
  }
}

function emptyTotals() {
  return {
    cost: 0,
    chat: { calls: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
    tts: { calls: 0, inputTokens: 0, outputTokens: 0 },
    stt: { calls: 0, seconds: 0 },
  };
}

function saveStore(store) {
  try {
    fs.writeFileSync(dataFile, JSON.stringify(store, null, 2));
  } catch (error) {
    console.error("Error writing usage store:", error);
  }
}

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function ensureBucket(store, model) {
  if (!store.byModel[model]) {
    store.byModel[model] = { cost: 0, calls: 0 };
  }
  const day = todayKey();
  if (!store.byDay[day]) {
    store.byDay[day] = { cost: 0, calls: 0 };
  }
  return { day };
}

function commit(store, model, cost) {
  const { day } = ensureBucket(store, model);
  store.totals.cost += cost;
  store.byDay[day].cost += cost;
  store.byDay[day].calls += 1;
  store.byModel[model].cost += cost;
  store.byModel[model].calls += 1;
  saveStore(store);
}

export function recordChatUsage(model, usage) {
  if (!usage) return 0;

  const price = PRICES.chat[model];
  if (!price) {
    console.warn(`Unknown chat model price for "${model}", recording without cost`);
  }

  const promptTokens = usage.prompt_tokens || 0;
  const completionTokens = usage.completion_tokens || 0;
  const cachedTokens =
    usage.prompt_tokens_details?.cached_tokens ||
    usage.cached_tokens ||
    0;
  const uncachedInput = Math.max(promptTokens - cachedTokens, 0);

  const cost = price
    ? (uncachedInput * price.input +
        cachedTokens * price.cachedInput +
        completionTokens * price.output) /
      1_000_000
    : 0;

  const store = loadStore();
  store.totals.chat.calls += 1;
  store.totals.chat.inputTokens += uncachedInput;
  store.totals.chat.cachedInputTokens += cachedTokens;
  store.totals.chat.outputTokens += completionTokens;
  commit(store, model, cost);
  return cost;
}

export function recordTtsUsage(model, inputText, usage) {
  const price = PRICES.tts[model];
  if (!price) {
    console.warn(`Unknown TTS model price for "${model}", recording without cost`);
  }

  // OpenAI возвращает usage для TTS не всегда — оцениваем токены по тексту,
  // если usage нет (1 токен ≈ 4 символа — грубая, но рабочая оценка).
  const inputTokens =
    usage?.input_tokens ?? Math.max(1, Math.ceil((inputText?.length || 0) / 4));
  const outputTokens = usage?.output_tokens ?? 0;

  const cost = price
    ? (inputTokens * price.input + outputTokens * price.output) / 1_000_000
    : 0;

  const store = loadStore();
  store.totals.tts.calls += 1;
  store.totals.tts.inputTokens += inputTokens;
  store.totals.tts.outputTokens += outputTokens;
  commit(store, model, cost);
  return cost;
}

export function recordSttUsage(model, durationSeconds) {
  const price = PRICES.stt[model];
  if (!price) {
    console.warn(`Unknown STT model price for "${model}", recording without cost`);
  }

  const seconds = durationSeconds || 0;
  const cost = price ? (seconds / 60) * price.perMinute : 0;

  const store = loadStore();
  store.totals.stt.calls += 1;
  store.totals.stt.seconds += seconds;
  commit(store, model, cost);
  return cost;
}

function formatUsd(value) {
  if (value < 0.01) return `$${value.toFixed(5)}`;
  return `$${value.toFixed(4)}`;
}

export function getStatsReport() {
  const store = loadStore();
  const today = todayKey();

  const monthPrefix = today.slice(0, 7);
  let monthCost = 0;
  let monthCalls = 0;
  for (const [day, entry] of Object.entries(store.byDay)) {
    if (day.startsWith(monthPrefix)) {
      monthCost += entry.cost;
      monthCalls += entry.calls;
    }
  }

  const todayEntry = store.byDay[today] || { cost: 0, calls: 0 };

  const lines = [];
  lines.push("📊 Расходы на OpenAI");
  lines.push("");
  lines.push(`Сегодня (${today}): ${formatUsd(todayEntry.cost)} — ${todayEntry.calls} вызовов`);
  lines.push(`Этот месяц (${monthPrefix}): ${formatUsd(monthCost)} — ${monthCalls} вызовов`);
  lines.push(`Всего: ${formatUsd(store.totals.cost)}`);
  lines.push("");

  const t = store.totals;
  lines.push("По типам:");
  lines.push(
    `• Chat: ${t.chat.calls} вызовов, in ${t.chat.inputTokens} (cached ${t.chat.cachedInputTokens}), out ${t.chat.outputTokens} токенов`
  );
  lines.push(
    `• TTS: ${t.tts.calls} вызовов, in ${t.tts.inputTokens}, out ${t.tts.outputTokens} токенов`
  );
  lines.push(
    `• STT: ${t.stt.calls} вызовов, ${(t.stt.seconds / 60).toFixed(2)} мин`
  );

  const models = Object.entries(store.byModel).sort((a, b) => b[1].cost - a[1].cost);
  if (models.length > 0) {
    lines.push("");
    lines.push("По моделям:");
    for (const [model, entry] of models) {
      lines.push(`• ${model}: ${formatUsd(entry.cost)} — ${entry.calls} вызовов`);
    }
  }

  return lines.join("\n");
}

export default {
  recordChatUsage,
  recordTtsUsage,
  recordSttUsage,
  getStatsReport,
};
