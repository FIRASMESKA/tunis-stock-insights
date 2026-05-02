import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchStocks, type StockListItem } from "@/lib/bvmt";
import { Link } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Change } from "@/components/StockBits";
import { Search, TrendingUp, TrendingDown, Activity, Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export default function Dashboard() {
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [watchTickers, setWatchTickers] = useState<Set<string>>(new Set());

  const { data: stocks = [], isLoading } = useQuery({
    queryKey: ["stocks"],
    queryFn: fetchStocks,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (!user) return;
    supabase.from("watchlist").select("ticker").eq("user_id", user.id).then(({ data }) => {
      setWatchTickers(new Set(data?.map((w: any) => w.ticker) ?? []));
    });
  }, [user]);

  const toggleWatch = async (s: StockListItem) => {
    if (!user) return;
    if (watchTickers.has(s.ticker)) {
      await supabase.from("watchlist").delete().eq("user_id", user.id).eq("ticker", s.ticker);
      setWatchTickers((p) => { const n = new Set(p); n.delete(s.ticker); return n; });
      toast(`${s.ticker} retirée`);
    } else {
      await supabase.from("watchlist").insert({ user_id: user.id, ticker: s.ticker, stock_name: s.stockName });
      setWatchTickers((p) => new Set(p).add(s.ticker));
      toast.success(`${s.ticker} ajoutée à la watchlist`);
    }
  };

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return stocks;
    return stocks.filter((s) =>
      s.ticker.toLowerCase().includes(term) || s.stockName.toLowerCase().includes(term)
    );
  }, [stocks, q]);

  const stats = useMemo(() => {
    const up = stocks.filter((s) => s.change > 0).length;
    const down = stocks.filter((s) => s.change < 0).length;
    const flat = stocks.length - up - down;
    const top = [...stocks].sort((a, b) => b.change - a.change).slice(0, 3);
    const flop = [...stocks].sort((a, b) => a.change - b.change).slice(0, 3);
    return { up, down, flat, top, flop };
  }, [stocks]);

  return (
    <div className="px-4 md:px-8 py-6 md:py-8 max-w-7xl mx-auto space-y-6">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-widest text-primary/80">Bourse de Tunis</p>
        <h1 className="font-display text-3xl md:text-4xl font-bold">Marché en direct</h1>
        <p className="text-muted-foreground text-sm">
          {isLoading ? "Chargement…" : `${stocks.length} actions cotées`} ·{" "}
          {stocks[0]?.seance && `Séance ${stocks[0].seance}`}
        </p>
      </header>

      {/* Stats */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={TrendingUp} label="En hausse" value={stats.up} className="text-bull" />
        <StatCard icon={TrendingDown} label="En baisse" value={stats.down} className="text-bear" />
        <StatCard icon={Activity} label="Stables" value={stats.flat} className="text-muted-foreground" />
        <StatCard icon={Star} label="Watchlist" value={watchTickers.size} className="text-primary" />
      </section>

      {/* Top movers */}
      <section className="grid md:grid-cols-2 gap-4">
        <MoversCard title="Top hausses" items={stats.top} positive />
        <MoversCard title="Top baisses" items={stats.flop} positive={false} />
      </section>

      {/* Search + table */}
      <section className="glass-card overflow-hidden">
        <div className="p-4 border-b flex items-center gap-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher BNA, BIAT, SFBT…"
            className="border-0 bg-transparent focus-visible:ring-0 h-8 px-0"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-muted-foreground bg-muted/30">
              <tr>
                <th className="text-left p-3 font-medium">Ticker</th>
                <th className="text-left p-3 font-medium hidden md:table-cell">Nom</th>
                <th className="text-right p-3 font-medium">Cours</th>
                <th className="text-right p-3 font-medium">Variation</th>
                <th className="text-right p-3 font-medium hidden lg:table-cell">Volume</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.ticker} className="border-t hover:bg-muted/30 transition-colors">
                  <td className="p-3">
                    <Link to={`/stock/${s.ticker}`} className="font-mono font-semibold text-primary hover:underline">
                      {s.ticker}
                    </Link>
                  </td>
                  <td className="p-3 hidden md:table-cell text-muted-foreground truncate max-w-[200px]">
                    {s.stockName}
                  </td>
                  <td className="p-3 text-right num font-medium">{s.last.toFixed(2)} TND</td>
                  <td className="p-3 text-right"><Change value={s.change} /></td>
                  <td className="p-3 text-right num text-muted-foreground hidden lg:table-cell">
                    {s.volume > 0 ? s.volume.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) : "—"}
                  </td>
                  <td className="p-3">
                    <button
                      onClick={() => toggleWatch(s)}
                      className={cn(
                        "p-1.5 rounded-md transition-colors",
                        watchTickers.has(s.ticker) ? "text-primary" : "text-muted-foreground hover:text-foreground"
                      )}
                      aria-label="watchlist"
                    >
                      <Star className="h-4 w-4" fill={watchTickers.has(s.ticker) ? "currentColor" : "none"} />
                    </button>
                  </td>
                </tr>
              ))}
              {!isLoading && filtered.length === 0 && (
                <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Aucun résultat</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, className }: { icon: any; label: string; value: number; className?: string }) {
  return (
    <div className="glass-card p-4 animate-slide-up">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
        <Icon className={cn("h-4 w-4", className)} />
      </div>
      <div className={cn("text-2xl font-display font-bold mt-2 num", className)}>{value}</div>
    </div>
  );
}

function MoversCard({ title, items, positive }: { title: string; items: StockListItem[]; positive: boolean }) {
  return (
    <div className="glass-card p-4">
      <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
        {positive ? <TrendingUp className="h-4 w-4 text-bull" /> : <TrendingDown className="h-4 w-4 text-bear" />}
        {title}
      </h2>
      <div className="space-y-2">
        {items.map((s) => (
          <Link key={s.ticker} to={`/stock/${s.ticker}`} className="flex items-center justify-between py-1.5 hover:bg-muted/30 px-2 -mx-2 rounded-md transition-colors">
            <div className="min-w-0">
              <div className="font-mono font-semibold text-sm">{s.ticker}</div>
              <div className="text-xs text-muted-foreground truncate">{s.stockName}</div>
            </div>
            <Change value={s.change} />
          </Link>
        ))}
      </div>
    </div>
  );
}
