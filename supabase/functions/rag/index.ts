// Embed text chunks et stocke dans document_chunks
// Body: { documentId: string, chunks: string[] }
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.105.1/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.1";

const EMBED_MODEL = "google/text-embedding-004"; // 768 dims

async function embed(texts: string[], apiKey: string): Promise<number[][]> {
  // Lovable AI Gateway expose l'API OpenAI-compatible /v1/embeddings
  const res = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`embed failed ${res.status}: ${t}`);
  }
  const json = await res.json();
  return json.data.map((d: any) => d.embedding);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { documentId, chunks, mode } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const auth = req.headers.get("Authorization");
    if (!auth) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Mode "query" : juste embed la requête et renvoyer matches
    if (mode === "query") {
      const [embedding] = await embed([chunks[0]], LOVABLE_API_KEY);
      const { data, error } = await admin.rpc("match_chunks", {
        query_embedding: embedding as any,
        match_count: 5,
        p_user_id: user.id,
      });
      if (error) throw error;
      return new Response(JSON.stringify({ matches: data }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Mode "ingest"
    await admin.from("documents").update({ status: "processing" }).eq("id", documentId).eq("user_id", user.id);

    // Embed par batch de 50
    const BATCH = 50;
    let inserted = 0;
    for (let i = 0; i < chunks.length; i += BATCH) {
      const batch = chunks.slice(i, i + BATCH);
      const embeds = await embed(batch, LOVABLE_API_KEY);
      const rows = batch.map((content: string, j: number) => ({
        document_id: documentId,
        user_id: user.id,
        chunk_index: i + j,
        content,
        embedding: embeds[j] as any,
      }));
      const { error } = await admin.from("document_chunks").insert(rows);
      if (error) throw error;
      inserted += batch.length;
    }

    await admin.from("documents").update({ status: "ready" }).eq("id", documentId).eq("user_id", user.id);

    return new Response(JSON.stringify({ inserted }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("rag error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
