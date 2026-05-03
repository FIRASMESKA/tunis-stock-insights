// Client API : récupère les vraies données BVMT live via l'edge function bvmt-scrape (Firecrawl + ilboursa.com)
import { supabase } from "@/integrations/supabase/client";

export type StockListItem = {
  ticker: string;
  stockName: string;
  arabName: string;
  isin: string;
  last: number;
  close: number;
  high: number;
  low: number;
  open: number;
  change: number;
  volume: number;
  caps: number;
  seance: string;
};

export type HistoryResponse = {
  s: string;
  t: number[];
  o: number[];
  h: number[];
  l: number[];
  c: number[];
  v: number[];
};

export type LiveQuote = {
  ticker: string;
  name?: string;
  isin?: string;
  last: number;
  open: number;
  high: number;
  low: number;
  prev: number;
  change: number;
  volume: number;
  capEch: number;
  valorisation?: string;
  asOf: string;
};

const SCRAPE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bvmt-scrape`;

async function callScrape<T>(params: Record<string, string>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${SCRAPE_URL}?${qs}`, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`bvmt-scrape error: ${res.status}`);
  return res.json();
}

export async function fetchStocks(): Promise<StockListItem[]> {
  const { quotes, asOf } = await callScrape<{ quotes: any[]; asOf: string }>({ action: "list" });
  const seance = new Date(asOf).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
  return quotes.map((q) => ({
    ticker: q.ticker,
    stockName: q.ticker,
    arabName: "",
    isin: "",
    last: q.last,
    close: q.last,
    open: q.open,
    high: q.high,
    low: q.low,
    change: q.change,
    volume: q.volume,
    caps: q.capEch,
    seance,
  }));
}

export async function fetchQuote(ticker: string): Promise<{ quote: LiveQuote; history: HistoryResponse }> {
  const { quote, history } = await callScrape<{ quote: LiveQuote; history: any[] }>({
    action: "quote",
    ticker,
  });
  // Convert history rows to TradingView UDF-like response so the rest of the code keeps working.
  const h: HistoryResponse = {
    s: history.length ? "ok" : "no_data",
    t: history.map((r) => r.t),
    o: history.map((r) => r.o),
    h: history.map((r) => r.h),
    l: history.map((r) => r.l),
    c: history.map((r) => r.c),
    v: history.map((r) => r.v),
  };
  return { quote, history: h };
}

// Conserve l'ancienne signature pour StockDetail.tsx
export async function fetchHistory(ticker: string, _days = 365): Promise<HistoryResponse> {
  const { history } = await fetchQuote(ticker);
  return history;
}
