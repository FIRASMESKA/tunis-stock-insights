// Edge function : proxy vers l'API publique irbe7 (CORS + cache)
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.105.1/cors";

const BASE = "https://data.irbe7.com/api/data";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const path = url.searchParams.get("path") ?? "";
    if (!path) {
      return new Response(JSON.stringify({ error: "missing path" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const target = `${BASE}/${path}`;
    const res = await fetch(target, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      return new Response(JSON.stringify({ error: "upstream", status: res.status }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const body = await res.text();
    return new Response(body, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60",
      },
    });
  } catch (e) {
    console.error("bvmt error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
