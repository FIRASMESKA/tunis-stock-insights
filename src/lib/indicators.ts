// Indicateurs techniques calculés en JS — pas de dépendance externe.

export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

export function toCandles(data: { t: number[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[] }): Candle[] {
  const n = data?.t?.length ?? 0;
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      t: data.t[i] * 1000, // sec -> ms
      o: data.o[i],
      h: data.h[i],
      l: data.l[i],
      c: data.c[i],
      v: data.v[i],
    });
  }
  return out;
}

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  const k = 2 / (period + 1);
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      out.push(null);
      continue;
    }
    if (prev === null) {
      const slice = values.slice(i - period + 1, i + 1);
      prev = slice.reduce((a, b) => a + b, 0) / period;
    } else {
      prev = values[i] * k + prev * (1 - k);
    }
    out.push(prev);
  }
  return out;
}

export function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = [null];
  let gains = 0;
  let losses = 0;
  for (let i = 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    if (i <= period) {
      gains += g;
      losses += l;
      if (i === period) {
        const avgG = gains / period;
        const avgL = losses / period;
        const rs = avgL === 0 ? 100 : avgG / avgL;
        out.push(100 - 100 / (1 + rs));
      } else {
        out.push(null);
      }
    } else {
      gains = (gains * (period - 1) + g) / period;
      losses = (losses * (period - 1) + l) / period;
      const rs = losses === 0 ? 100 : gains / losses;
      out.push(100 - 100 / (1 + rs));
    }
  }
  return out;
}

export function macd(values: number[], fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine = values.map((_, i) => {
    const a = emaFast[i];
    const b = emaSlow[i];
    return a !== null && b !== null ? a - b : null;
  });
  const validMacd = macdLine.map((v) => (v ?? 0));
  const signalLine = ema(validMacd, signal).map((v, i) => (macdLine[i] === null ? null : v));
  const histogram = macdLine.map((v, i) => (v !== null && signalLine[i] !== null ? v - (signalLine[i] as number) : null));
  return { macdLine, signalLine, histogram };
}

/** Detect support/resistance via pivot points (lookback window) */
export function supportResistance(candles: Candle[], lookback = 5) {
  const supports: number[] = [];
  const resistances: number[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const window = candles.slice(i - lookback, i + lookback + 1);
    const highs = window.map((c) => c.h);
    const lows = window.map((c) => c.l);
    if (candles[i].h === Math.max(...highs)) resistances.push(candles[i].h);
    if (candles[i].l === Math.min(...lows)) supports.push(candles[i].l);
  }
  // Cluster proches (1% tolérance) et garder les plus récents
  const cluster = (arr: number[]) => {
    arr.sort((a, b) => a - b);
    const out: number[] = [];
    for (const v of arr) {
      if (!out.length || Math.abs(v - out[out.length - 1]) / out[out.length - 1] > 0.01) out.push(v);
    }
    return out;
  };
  return { supports: cluster(supports).slice(-3), resistances: cluster(resistances).slice(-3) };
}

export function detectTrend(closes: number[]): "up" | "down" | "sideways" {
  if (closes.length < 20) return "sideways";
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, Math.min(50, Math.floor(closes.length / 2)));
  const last20 = ema20[ema20.length - 1];
  const last50 = ema50[ema50.length - 1];
  if (last20 === null || last50 === null) return "sideways";
  const diff = (last20 - last50) / last50;
  if (diff > 0.01) return "up";
  if (diff < -0.01) return "down";
  return "sideways";
}

export type AIScore = "buy" | "sell" | "hold";

export function computeAIScore(closes: number[]): { score: AIScore; confidence: number; reasons: string[] } {
  const reasons: string[] = [];
  let bull = 0;
  let bear = 0;

  const lastClose = closes[closes.length - 1];
  const trend = detectTrend(closes);
  if (trend === "up") {
    bull += 2;
    reasons.push("Tendance haussière (EMA20 > EMA50)");
  } else if (trend === "down") {
    bear += 2;
    reasons.push("Tendance baissière (EMA20 < EMA50)");
  } else {
    reasons.push("Tendance latérale");
  }

  const rsiArr = rsi(closes, 14);
  const lastRsi = rsiArr[rsiArr.length - 1];
  if (lastRsi !== null) {
    if (lastRsi < 30) {
      bull += 2;
      reasons.push(`RSI ${lastRsi.toFixed(1)} : survente`);
    } else if (lastRsi > 70) {
      bear += 2;
      reasons.push(`RSI ${lastRsi.toFixed(1)} : surachat`);
    } else if (lastRsi > 50) {
      bull += 1;
      reasons.push(`RSI ${lastRsi.toFixed(1)} : momentum positif`);
    } else {
      bear += 1;
      reasons.push(`RSI ${lastRsi.toFixed(1)} : momentum négatif`);
    }
  }

  const m = macd(closes);
  const lastHist = m.histogram[m.histogram.length - 1];
  if (lastHist !== null) {
    if (lastHist > 0) {
      bull += 1;
      reasons.push("Histogramme MACD positif");
    } else {
      bear += 1;
      reasons.push("Histogramme MACD négatif");
    }
  }

  const total = bull + bear || 1;
  const confidence = Math.round((Math.abs(bull - bear) / total) * 100);
  let score: AIScore = "hold";
  if (bull - bear >= 2) score = "buy";
  else if (bear - bull >= 2) score = "sell";

  return { score, confidence, reasons };
}
