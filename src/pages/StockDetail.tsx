import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchHistory, fetchStocks } from "@/lib/bvmt";
import { toCandles, rsi, macd, ema, supportResistance, computeAIScore } from "@/lib/indicators";
import { ArrowLeft, MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Change, ScorePill } from "@/components/StockBits";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend,
  TimeScale, Filler, BarElement,
} from "chart.js";
import "chartjs-adapter-date-fns";
import { Line, Bar } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, TimeScale, Filler);

export default function StockDetail() {
  const { ticker = "" } = useParams();
  const [period, setPeriod] = useState(180);

  const { data: stocks = [] } = useQuery({ queryKey: ["stocks"], queryFn: fetchStocks });
  const meta = stocks.find((s) => s.ticker === ticker);

  // Use stockName from the `principaux` API as the symbol for the history endpoint when available.
  // Wait for stocks to be loaded before fetching history to ensure we can use meta.stockName.
  const symbol = meta?.stockName ?? ticker;
  const { data: history, isLoading } = useQuery({
    queryKey: ["history", symbol, period],
    queryFn: () => fetchHistory(symbol, period),
    enabled: !!ticker && stocks.length > 0,
  });

  const candles = useMemo(() => (history ? toCandles(history) : []), [history]);
  const closes = candles.map((c) => c.c);

  const ema20 = useMemo(() => ema(closes, 20), [closes]);
  const ema50 = useMemo(() => ema(closes, 50), [closes]);
  const rsiArr = useMemo(() => rsi(closes, 14), [closes]);
  const macdRes = useMemo(() => macd(closes), [closes]);
  const sr = useMemo(() => supportResistance(candles), [candles]);
  const aiScore = useMemo(() => (closes.length ? computeAIScore(closes) : null), [closes]);

  const labels = candles.map((c) => new Date(c.t));

  const priceData = {
    labels,
    datasets: [
      {
        label: "Cours",
        data: closes,
        borderColor: "hsl(174 80% 55%)",
        backgroundColor: "hsl(174 80% 45% / 0.12)",
        fill: true,
        tension: 0.25,
        pointRadius: 0,
        borderWidth: 2,
      },
      {
        label: "EMA 20",
        data: ema20,
        borderColor: "hsl(45 95% 60%)",
        borderWidth: 1.2,
        pointRadius: 0,
        fill: false,
      },
      {
        label: "EMA 50",
        data: ema50,
        borderColor: "hsl(280 70% 65%)",
        borderWidth: 1.2,
        pointRadius: 0,
        fill: false,
      },
    ],
  };

  const chartOpts: any = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { labels: { color: "hsl(217 12% 70%)", boxWidth: 10, font: { size: 10 } } },
      tooltip: { backgroundColor: "hsl(222 26% 9%)", borderColor: "hsl(222 18% 16%)", borderWidth: 1 },
    },
    scales: {
      x: { type: "time", time: { unit: period > 180 ? "month" : "week" }, ticks: { color: "hsl(217 12% 50%)" }, grid: { color: "hsl(222 18% 14%)" } },
      y: { ticks: { color: "hsl(217 12% 50%)" }, grid: { color: "hsl(222 18% 14%)" } },
    },
  };

  const rsiData = {
    labels,
    datasets: [{ label: "RSI 14", data: rsiArr, borderColor: "hsl(174 80% 55%)", borderWidth: 1.5, pointRadius: 0, fill: false }],
  };
  const rsiOpts: any = { ...chartOpts, scales: { ...chartOpts.scales, y: { ...chartOpts.scales.y, min: 0, max: 100 } } };

  const macdData = {
    labels,
    datasets: [
      { label: "MACD", data: macdRes.macdLine, borderColor: "hsl(174 80% 55%)", borderWidth: 1.5, pointRadius: 0, fill: false, type: "line" as const },
      { label: "Signal", data: macdRes.signalLine, borderColor: "hsl(45 95% 60%)", borderWidth: 1.5, pointRadius: 0, fill: false, type: "line" as const },
      {
        label: "Histogramme",
        data: macdRes.histogram,
        backgroundColor: macdRes.histogram.map((v) => (v !== null && v >= 0 ? "hsl(152 70% 48% / 0.6)" : "hsl(0 80% 62% / 0.6)")),
        type: "bar" as const,
      },
    ],
  };

  return (
    <div className="px-4 md:px-8 py-6 md:py-8 max-w-7xl mx-auto space-y-6">
      <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Retour
      </Link>

      {/* Header */}
      <header className="flex flex-wrap items-end gap-4 justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest text-primary/80 font-mono">{ticker}</p>
          <h1 className="font-display text-3xl md:text-4xl font-bold">{meta?.stockName ?? ticker}</h1>
          {meta && (
            <div className="flex items-center gap-3 mt-2">
              <span className="text-2xl font-display font-semibold num">{meta.last.toFixed(2)} TND</span>
              <Change value={meta.change} />
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {aiScore && (
            <div className="glass-card px-4 py-2 flex items-center gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Score IA</div>
                <div className="text-xs text-muted-foreground">Confiance {aiScore.confidence}%</div>
              </div>
              <ScorePill score={aiScore.score} />
            </div>
          )}
          <Button asChild variant="outline" size="sm">
            <Link to={`/chat?ticker=${ticker}`}><MessageSquareText className="h-4 w-4 mr-2" />Demander à l'IA</Link>
          </Button>
        </div>
      </header>

      {/* Period tabs */}
      <Tabs value={String(period)} onValueChange={(v) => setPeriod(Number(v))}>
        <TabsList>
          <TabsTrigger value="30">1M</TabsTrigger>
          <TabsTrigger value="90">3M</TabsTrigger>
          <TabsTrigger value="180">6M</TabsTrigger>
          <TabsTrigger value="365">1A</TabsTrigger>
          <TabsTrigger value="1095">3A</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Main chart */}
      <section className="glass-card p-4">
        <h2 className="text-sm font-semibold mb-3">Cours & EMA</h2>
        <div className="h-[360px]">
          {isLoading ? (
            <div className="h-full grid place-items-center text-muted-foreground">Chargement…</div>
          ) : candles.length ? (
            <Line data={priceData} options={chartOpts} />
          ) : (
            <div className="h-full grid place-items-center text-muted-foreground">Aucun historique</div>
          )}
        </div>
      </section>

      <section className="grid lg:grid-cols-2 gap-4">
        <div className="glass-card p-4">
          <h2 className="text-sm font-semibold mb-3">RSI (14)</h2>
          <div className="h-[200px]"><Line data={rsiData} options={rsiOpts} /></div>
        </div>
        <div className="glass-card p-4">
          <h2 className="text-sm font-semibold mb-3">MACD (12, 26, 9)</h2>
          <div className="h-[200px]"><Bar data={macdData as any} options={chartOpts} /></div>
        </div>
      </section>

      {/* Analysis */}
      {aiScore && (
        <section className="grid md:grid-cols-2 gap-4">
          <div className="glass-card p-5">
            <h2 className="text-sm font-semibold mb-3">Analyse technique automatique</h2>
            <ul className="space-y-2 text-sm">
              {aiScore.reasons.map((r, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-primary mt-1.5 h-1 w-1 rounded-full bg-primary shrink-0" />
                  {r}
                </li>
              ))}
            </ul>
          </div>
          <div className="glass-card p-5">
            <h2 className="text-sm font-semibold mb-3">Supports & Résistances</h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-xs uppercase tracking-wider text-bear mb-2">Résistances</div>
                {sr.resistances.length ? sr.resistances.map((v, i) => (
                  <div key={i} className="num font-mono py-1 border-b border-border/40 last:border-0">{v.toFixed(2)} TND</div>
                )) : <div className="text-muted-foreground">—</div>}
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-bull mb-2">Supports</div>
                {sr.supports.length ? sr.supports.map((v, i) => (
                  <div key={i} className="num font-mono py-1 border-b border-border/40 last:border-0">{v.toFixed(2)} TND</div>
                )) : <div className="text-muted-foreground">—</div>}
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
