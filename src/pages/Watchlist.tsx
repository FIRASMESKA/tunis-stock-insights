import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Link } from "react-router-dom";
import { Star, TrendingUp } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { fetchStocks } from "@/lib/bvmt";
import { Change } from "@/components/StockBits";
import { Button } from "@/components/ui/button";

export default function Watchlist() {
  const { user } = useAuth();
  const [tickers, setTickers] = useState<string[]>([]);
  const { data: stocks = [] } = useQuery({ queryKey: ["stocks"], queryFn: fetchStocks });

  useEffect(() => {
    if (!user) return;
    supabase.from("watchlist").select("ticker").eq("user_id", user.id).then(({ data }) => {
      setTickers((data ?? []).map((w: any) => w.ticker));
    });
  }, [user]);

  const items = stocks.filter((s) => tickers.includes(s.ticker));

  return (
    <div className="px-4 md:px-8 py-6 md:py-8 max-w-5xl mx-auto space-y-6">
      <header>
        <p className="text-xs uppercase tracking-widest text-primary/80">Mon suivi</p>
        <h1 className="font-display text-3xl md:text-4xl font-bold">Watchlist</h1>
      </header>

      {items.length === 0 ? (
        <div className="glass-card p-10 text-center">
          <Star className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground mb-4">Aucune action suivie pour le moment.</p>
          <Button asChild><Link to="/">Découvrir le marché</Link></Button>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {items.map((s) => (
            <Link key={s.ticker} to={`/stock/${s.ticker}`} className="glass-card p-4 hover:shadow-glow transition-all">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-mono font-semibold text-primary">{s.ticker}</div>
                  <div className="text-sm text-muted-foreground truncate">{s.stockName}</div>
                </div>
                <div className="text-right">
                  <div className="num font-display text-lg">{s.last.toFixed(2)}</div>
                  <Change value={s.change} />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
