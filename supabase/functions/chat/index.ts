// Chat IA streaming + support multimodal (images de graphiques) + RAG
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.105.1/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.1";

const SYSTEM = `Tu es un analyste financier expert spécialisé dans la Bourse de Tunis (BVMT).
Tu aides l'utilisateur à comprendre les actions tunisiennes : analyse technique (RSI, MACD, supports/résistances, tendances), analyse fondamentale (PER, ROE, marges, dividendes), et lecture de graphiques.

Règles :
- Réponds en français, de manière concise et structurée (markdown avec listes et titres).
- Quand on te montre une image de graphique, analyse-la : tendance, patterns (Elliott, drapeaux, têtes-épaules), supports/résistances visibles, signaux.
- Si du contexte de documents (RAG) est fourni, cite-le explicitement.
- Tes analyses sont éducatives, pas des conseils d'investissement.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages, ragContext } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");

    const systemContent = ragContext
      ? `${SYSTEM}\n\n--- Contexte documents (RAG) ---\n${ragContext}\n--- Fin contexte ---`
      : SYSTEM;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "system", content: systemContent }, ...messages],
        stream: true,
      }),
    });

    if (response.status === 429) {
      return new Response(JSON.stringify({ error: "Limite de requêtes atteinte. Réessayez dans un instant." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (response.status === 402) {
      return new Response(JSON.stringify({ error: "Crédits IA épuisés. Ajoutez des crédits dans votre workspace Lovable." }), {
        status: 402,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!response.ok) {
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
