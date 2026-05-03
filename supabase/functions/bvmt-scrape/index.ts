// Edge function : scrape ilboursa.com via Firecrawl pour récupérer les VRAIES cotations BVMT
// (les API directes BVMT/ilboursa sont protégées par Cloudflare)
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.105.1/cors";

const FIRECRAWL = "https://api.firecrawl.dev/v2/scrape";

type Quote = {
  ticker: string;
  name?: string;
  isin?: string;
  last: number;
  open: number;
  high: number;
  low: number;
  prev: number;
  change: number;       // %
  volume: number;       // titres
  capEch: number;       // DT
  valorisation?: string;
  asOf: string;         // ISO datetime of scrape
};

type HistoryRow = { t: number; o: number; h: number; l: number; c: number; v: number };

const FR_NUM = (s: string) =>
  Number(String(s).replace(/\u00A0|\s/g, "").replace(",", ".").replace(/[^\d.\-]/g, ""));

async function firecrawlMarkdown(url: string, key: string, waitFor = 0): Promise<string> {
  const res = await fetch(FIRECRAWL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      formats: ["markdown"],
      onlyMainContent: true,
      waitFor,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Firecrawl ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  return data?.data?.markdown ?? data?.markdown ?? "";
}

async function firecrawlHtml(url: string, key: string): Promise<string> {
  const res = await fetch(FIRECRAWL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url, formats: ["html"], onlyMainContent: false }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Firecrawl ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  return data?.data?.html ?? data?.html ?? "";
}

/** Parse table /marches/aaz pour la liste complète. */
function parseListMarkdown(md: string): Quote[] {
  // Lignes type: | [SOTET](...) | 9.57 | 10.14 | 9.57 | 175 640 | 1 750 000 | 10.14 | +12.29% |
  const out: Quote[] = [];
  const lines = md.split("\n");
  for (const line of lines) {
    if (!line.startsWith("|") || !line.includes("[")) continue;
    const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
    if (cells.length < 8) continue;
    const m = cells[0].match(/\[([A-Z0-9.]+)\]/i);
    if (!m) continue;
    const ticker = m[1];
    const open = FR_NUM(cells[1]);
    const high = FR_NUM(cells[2]);
    const low = FR_NUM(cells[3]);
    const volume = FR_NUM(cells[4]);
    const capEch = FR_NUM(cells[5]);
    const last = FR_NUM(cells[6]);
    const change = FR_NUM(cells[7]);
    if (!ticker || !isFinite(last)) continue;
    out.push({
      ticker, last, open, high, low, prev: last && change ? +(last / (1 + change / 100)).toFixed(3) : last,
      change, volume, capEch, asOf: new Date().toISOString(),
    });
  }
  return out;
}

/** Parse une fiche cotation_TICKER (plus précise + ISIN + nom). */
function parseQuoteHtml(html: string, ticker: string): Quote {
  const grab = (re: RegExp) => {
    const m = html.match(re);
    return m ? m[1] : "";
  };
  const name = grab(/<h1[^>]*>\s*([A-Z0-9 \-&'éèàÉÈÀ]+)\s*:[^<]*<\/h1>/i).trim();
  const isin = grab(/ISIN\s*:\s*([A-Z0-9]+)/i);
  const last = FR_NUM(grab(/cot_v1b[^>]*>([^<]+)/));
  const change = FR_NUM(grab(/quote_up\d[^>]*>\+?([^<]+)/));
  const open = FR_NUM(grab(/OUVERTURE<\/div>\s*<div>([^<]+)/));
  const high = FR_NUM(grab(/\+ HAUT<\/div>\s*<div>([^<]+)/));
  const prev = FR_NUM(grab(/VEILLE<\/div>\s*<div>([^<]+)/));
  const low = FR_NUM(grab(/\+ BAS<\/div>\s*<div>([^<]+)/));
  const volume = FR_NUM(grab(/VOLUME<\/div>\s*<div[^>]*>([^<]+)/));
  const valorisation = grab(/VALO[^<]*<\/span><\/div>\s*<div>([^<]+)/).trim();
  return {
    ticker, name, isin, last, open, high, low, prev,
    change: last > prev ? +Math.abs(change).toFixed(2) : -Math.abs(change),
    volume, capEch: 0, valorisation, asOf: new Date().toISOString(),
  };
}

/** Génère un historique synthétique depuis page cotation (variations 1S/1M/1A/3A/5A) +
 *  quote courante. Utile pour les graphes quand on n'a que les sommaires. */
function buildSyntheticHistory(q: Quote, html: string): HistoryRow[] {
  // tableau "tableVar" : 1 semaine / 1 mois / 1er janvier / 1 an / 3 ans / 5 ans
  const reRow = /<tr>\s*<td>([^<]+)<\/td>\s*<td>([^<]+)<\/td>\s*<td>([^<]+)<\/td>\s*<td[^>]*>([^<]+)<\/td>/gi;
  const variations: { label: string; high: number; low: number; varPct: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = reRow.exec(html))) {
    variations.push({
      label: m[1].trim(),
      high: FR_NUM(m[2]),
      low: FR_NUM(m[3]),
      varPct: FR_NUM(m[4]),
    });
  }
  // On ne dispose que de bornes -> on génère une série "indicative" par interpolation.
  // Plus précise serait de tirer le CSV download (Cloudflare). Acceptable visuellement.
  const periods: Record<string, number> = {
    "1 semaine": 7, "1 mois": 30, "1er janvier": 120, "1 an": 365, "3 ans": 365 * 3, "5 ans": 365 * 5,
  };
  const points: HistoryRow[] = [];
  const now = Date.now();
  // anchor today = q.last
  for (const v of variations) {
    const days = periods[v.label] ?? 30;
    const startPrice = q.last / (1 + v.varPct / 100);
    points.push({
      t: Math.floor((now - days * 86400_000) / 1000),
      o: startPrice, h: v.high, l: v.low, c: startPrice, v: 0,
    });
  }
  points.push({ t: Math.floor(now / 1000), o: q.open || q.last, h: q.high || q.last, l: q.low || q.last, c: q.last, v: q.volume });
  // tri + dédup
  points.sort((a, b) => a.t - b.t);
  return points;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const KEY = Deno.env.get("FIRECRAWL_API_KEY");
  if (!KEY) {
    return new Response(JSON.stringify({ error: "FIRECRAWL_API_KEY missing" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") ?? "list";

    if (action === "list") {
      const md = await firecrawlMarkdown("https://www.ilboursa.com/marches/aaz", KEY);
      const quotes = parseListMarkdown(md);
      return new Response(JSON.stringify({ asOf: new Date().toISOString(), quotes }), {
        headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "public, max-age=120" },
      });
    }

    if (action === "quote") {
      const ticker = (url.searchParams.get("ticker") ?? "").toUpperCase();
      if (!ticker) throw new Error("missing ticker");
      const html = await firecrawlHtml(`https://www.ilboursa.com/marches/cotation_${ticker}`, KEY);
      const quote = parseQuoteHtml(html, ticker);
      const history = buildSyntheticHistory(quote, html);
      return new Response(JSON.stringify({ quote, history }), {
        headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "public, max-age=180" },
      });
    }

    return new Response(JSON.stringify({ error: "unknown action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("bvmt-scrape error", e);
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
