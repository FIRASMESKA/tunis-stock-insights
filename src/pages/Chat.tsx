import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Image as ImageIcon, Send, Loader2, X, FileSearch } from "lucide-react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { useSearchParams } from "react-router-dom";

type Msg = { id?: string; role: "user" | "assistant"; content: string; image_url?: string | null };

export default function Chat() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [convId, setConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [useRag, setUseRag] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Initial conversation + suggestions
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("conversations")
        .select("id")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      let id = data?.id as string | undefined;
      if (!id) {
        const { data: c } = await supabase
          .from("conversations")
          .insert({ user_id: user.id, title: "Discussion" })
          .select("id").single();
        id = c?.id;
      }
      setConvId(id ?? null);

      if (id) {
        const { data: msgs } = await supabase
          .from("messages").select("*").eq("conversation_id", id).order("created_at");
        setMessages((msgs ?? []).map((m: any) => ({ id: m.id, role: m.role, content: m.content, image_url: m.image_url })));
      }

      const t = params.get("ticker");
      if (t && (!data || !id)) {
        setInput(`Fais-moi une analyse complète de l'action ${t} (BVMT) : tendance, RSI, MACD, supports/résistances, score buy/sell/hold.`);
      } else if (t) {
        setInput(`Analyse rapide de ${t} aujourd'hui ?`);
      }
    })();
  }, [user, params]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const onPickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) return toast.error("Image > 5 Mo");
    setImageFile(f);
    setImagePreview(URL.createObjectURL(f));
  };

  const send = async () => {
    if (!input.trim() && !imageFile) return;
    if (!user || !convId) return;
    setLoading(true);

    let imageUrl: string | null = null;
    if (imageFile) {
      const path = `${user.id}/${Date.now()}-${imageFile.name}`;
      const { error: upErr } = await supabase.storage.from("chat-images").upload(path, imageFile, { contentType: imageFile.type });
      if (upErr) { toast.error("Upload échoué"); setLoading(false); return; }
      const { data } = supabase.storage.from("chat-images").getPublicUrl(path);
      imageUrl = data.publicUrl;
    }

    const userMsg: Msg = { role: "user", content: input || "(image jointe)", image_url: imageUrl };
    const next = [...messages, userMsg];
    setMessages(next);
    await supabase.from("messages").insert({ conversation_id: convId, user_id: user.id, role: "user", content: userMsg.content, image_url: imageUrl });
    setInput(""); setImageFile(null); setImagePreview(null);

    // RAG
    let ragContext: string | undefined;
    if (useRag) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/rag`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({ mode: "query", chunks: [userMsg.content] }),
        });
        const j = await r.json();
        if (j.matches?.length) ragContext = j.matches.map((m: any, i: number) => `[${i + 1}] ${m.content}`).join("\n\n");
      } catch (e) { console.error(e); }
    }

    // Prepare API messages — multimodal if image
    const apiMessages = next.map((m) => {
      if (m.image_url && m.role === "user") {
        return {
          role: m.role,
          content: [
            { type: "text", text: m.content },
            { type: "image_url", image_url: { url: m.image_url } },
          ],
        };
      }
      return { role: m.role, content: m.content };
    });

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ messages: apiMessages, ragContext }),
      });

      if (resp.status === 429) { toast.error("Limite atteinte, patientez"); setLoading(false); return; }
      if (resp.status === 402) { toast.error("Crédits IA épuisés"); setLoading(false); return; }
      if (!resp.ok || !resp.body) { toast.error("Erreur IA"); setLoading(false); return; }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let assistant = "";
      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n")) !== -1) {
          let line = buf.slice(0, idx); buf = buf.slice(idx + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const j = line.slice(6).trim();
          if (j === "[DONE]") break;
          try {
            const p = JSON.parse(j);
            const c = p.choices?.[0]?.delta?.content;
            if (c) {
              assistant += c;
              setMessages((prev) => {
                const copy = [...prev];
                copy[copy.length - 1] = { role: "assistant", content: assistant };
                return copy;
              });
            }
          } catch { buf = line + "\n" + buf; break; }
        }
      }

      await supabase.from("messages").insert({ conversation_id: convId, user_id: user.id, role: "assistant", content: assistant });
      await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId);
    } catch (e) {
      console.error(e); toast.error("Erreur réseau");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] md:h-screen">
      <header className="border-b px-4 md:px-8 py-4 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest text-primary/80">Assistant IA</p>
          <h1 className="font-display text-xl md:text-2xl font-bold">Chat analyse</h1>
        </div>
        <Button
          variant={useRag ? "default" : "outline"}
          size="sm"
          onClick={() => setUseRag((v) => !v)}
          title="Utiliser vos documents"
        >
          <FileSearch className="h-4 w-4 mr-2" /> RAG {useRag ? "ON" : "OFF"}
        </Button>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-4 max-w-3xl w-full mx-auto">
        {messages.length === 0 && (
          <div className="text-center py-16 animate-fade-in">
            <div className="inline-block px-3 py-1 rounded-full bg-primary/10 text-primary text-xs uppercase tracking-widest mb-4">Démarrer</div>
            <h2 className="font-display text-2xl font-bold mb-2">Posez vos questions sur la BVMT</h2>
            <p className="text-muted-foreground text-sm max-w-md mx-auto">
              Demandez une analyse, comparez deux actions, ou uploadez un graphique pour le faire analyser.
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div className={
              m.role === "user"
                ? "max-w-[85%] bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-2.5"
                : "max-w-[90%] bg-card border rounded-2xl rounded-tl-sm px-4 py-3"
            }>
              {m.image_url && (
                <img src={m.image_url} alt="upload" className="rounded-lg mb-2 max-h-60" />
              )}
              {m.role === "assistant" ? (
                <div className="prose prose-sm prose-invert max-w-none prose-headings:font-display prose-p:my-2 prose-li:my-0.5">
                  <ReactMarkdown>{m.content || "…"}</ReactMarkdown>
                </div>
              ) : (
                <p className="text-sm whitespace-pre-wrap">{m.content}</p>
              )}
            </div>
          </div>
        ))}
        {loading && messages[messages.length - 1]?.role !== "assistant" && (
          <div className="flex"><Loader2 className="h-4 w-4 animate-spin text-primary" /></div>
        )}
      </div>

      <div className="border-t bg-card/40 backdrop-blur-xl px-4 md:px-8 py-3 max-w-3xl w-full mx-auto">
        {imagePreview && (
          <div className="relative inline-block mb-2">
            <img src={imagePreview} className="h-20 rounded-md" />
            <button onClick={() => { setImageFile(null); setImagePreview(null); }} className="absolute -top-2 -right-2 bg-bear text-bear-foreground rounded-full p-0.5">
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <label className="cursor-pointer p-2 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            <ImageIcon className="h-5 w-5" />
            <input type="file" accept="image/*" className="hidden" onChange={onPickImage} />
          </label>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Analyse BNA, montre-moi un graphique…"
            rows={1}
            className="min-h-[42px] max-h-32 resize-none"
            disabled={loading}
          />
          <Button onClick={send} disabled={loading || (!input.trim() && !imageFile)} size="icon">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
