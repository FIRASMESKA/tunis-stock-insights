// Client API pour l'API publique irbe7 (Bourse de Tunis), via edge function proxy
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

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bvmt`;

async function call<T>(path: string): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${FN_URL}?path=${encodeURIComponent(path)}`, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`BVMT API error: ${res.status}`);
  return res.json();
}

export async function fetchStocks(): Promise<StockListItem[]> {
  const raw = await call<any[]>("principaux");
  return raw
    .filter((r) => r.referentiel?.ticker)
    .map((r) => ({
      ticker: r.referentiel.ticker,
      stockName: r.referentiel.stockName,
      arabName: r.referentiel.arabName,
      isin: r.referentiel.isin,
      last: r.last ?? r.close ?? 0,
      close: r.close ?? 0,
      high: r.high ?? 0,
      low: r.low ?? 0,
      change: r.change ?? 0,
      volume: r.volume ?? 0,
      caps: r.caps ?? 0,
      seance: r.seance ?? "",
    }));
}

export async function fetchHistory(ticker: string, days = 365): Promise<HistoryResponse> {
  const to = Math.floor(Date.now() / 1000);
  const from = to - days * 24 * 3600;
  return call<HistoryResponse>(`history?symbol=${ticker}&resolution=1D&from=${from}&to=${to}&countback=${days}`);
}
