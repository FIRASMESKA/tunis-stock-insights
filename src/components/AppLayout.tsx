import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LayoutDashboard, MessageSquareText, FileText, LogOut, TrendingUp, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/watchlist", label: "Watchlist", icon: Star },
  { to: "/chat", label: "Chat IA", icon: MessageSquareText },
  { to: "/documents", label: "Documents", icon: FileText },
];

export default function AppLayout() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate("/auth", { replace: true });
  }, [loading, user, navigate]);

  if (loading || !user) {
    return <div className="min-h-screen grid place-items-center text-muted-foreground">Chargement…</div>;
  }

  return (
    <div className="min-h-screen flex">
      <aside className="hidden md:flex flex-col w-60 border-r bg-card/40 backdrop-blur-xl">
        <div className="px-5 py-5 flex items-center gap-2 border-b">
          <div className="h-9 w-9 rounded-lg bg-gradient-primary grid place-items-center shadow-glow">
            <TrendingUp className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <div className="font-display font-bold leading-tight">Tunis Bourse</div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">BVMT · IA</div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                  isActive
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )
              }
            >
              <n.icon className="h-4 w-4" />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t">
          <div className="text-xs text-muted-foreground px-3 truncate mb-2">{user.email}</div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2"
            onClick={async () => {
              await supabase.auth.signOut();
              navigate("/auth");
            }}
          >
            <LogOut className="h-4 w-4" /> Déconnexion
          </Button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="md:hidden fixed top-0 inset-x-0 z-30 h-14 border-b bg-background/80 backdrop-blur-xl flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-md bg-gradient-primary grid place-items-center">
            <TrendingUp className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="font-display font-semibold">Tunis Bourse</span>
        </div>
        <Button variant="ghost" size="sm" onClick={async () => { await supabase.auth.signOut(); navigate("/auth"); }}>
          <LogOut className="h-4 w-4" />
        </Button>
      </header>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t bg-background/90 backdrop-blur-xl flex">
        {nav.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              cn("flex-1 flex flex-col items-center gap-1 py-2 text-[10px]",
                isActive ? "text-primary" : "text-muted-foreground")
            }
          >
            <n.icon className="h-5 w-5" />
            {n.label}
          </NavLink>
        ))}
      </nav>

      <main className="flex-1 min-w-0 pt-14 pb-20 md:pt-0 md:pb-0">
        <Outlet />
      </main>
    </div>
  );
}
