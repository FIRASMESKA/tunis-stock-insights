import { cn } from "@/lib/utils";

export function Change({ value, className }: { value: number; className?: string }) {
  const positive = value > 0;
  const negative = value < 0;
  return (
    <span
      className={cn(
        "stat-pill",
        positive && "bg-bull/15 text-bull",
        negative && "bg-bear/15 text-bear",
        !positive && !negative && "bg-muted text-muted-foreground",
        className
      )}
    >
      {positive ? "▲" : negative ? "▼" : "■"} {value > 0 ? "+" : ""}{value.toFixed(2)}%
    </span>
  );
}

export function ScorePill({ score }: { score: "buy" | "sell" | "hold" }) {
  const map = {
    buy: { label: "BUY", cls: "bg-bull/20 text-bull border-bull/30" },
    sell: { label: "SELL", cls: "bg-bear/20 text-bear border-bear/30" },
    hold: { label: "HOLD", cls: "bg-muted text-muted-foreground border-border" },
  } as const;
  const m = map[score];
  return (
    <span className={cn("stat-pill border font-bold tracking-wider", m.cls)}>
      {m.label}
    </span>
  );
}
