import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, FileText, Trash2, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
// pdf.js
import * as pdfjsLib from "pdfjs-dist";
// @ts-ignore
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

type Doc = { id: string; title: string; status: string; created_at: string; error_message?: string };

async function extractPdfChunks(file: File, chunkSize = 1000): Promise<string[]> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let full = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    full += tc.items.map((it: any) => it.str).join(" ") + "\n\n";
  }
  // Chunks ~1000 chars sans couper les mots brutalement
  const chunks: string[] = [];
  let i = 0;
  while (i < full.length) {
    let end = Math.min(i + chunkSize, full.length);
    if (end < full.length) {
      const lastSpace = full.lastIndexOf(" ", end);
      if (lastSpace > i + chunkSize / 2) end = lastSpace;
    }
    const c = full.slice(i, end).trim();
    if (c.length > 50) chunks.push(c);
    i = end;
  }
  return chunks;
}

export default function Documents() {
  const { user } = useAuth();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [uploading, setUploading] = useState(false);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const refresh = async () => {
    if (!user) return;
    const { data } = await supabase.from("documents").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
    setDocs((data ?? []) as Doc[]);
  };

  useEffect(() => { refresh(); }, [user]);

  const upload = async () => {
    if (!user || !file) return;
    if (!title.trim()) return toast.error("Titre requis");
    setUploading(true);
    try {
      const path = `${user.id}/${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage.from("rag-pdfs").upload(path, file, { contentType: "application/pdf" });
      if (upErr) throw upErr;

      const { data: doc, error: dErr } = await supabase
        .from("documents")
        .insert({ user_id: user.id, title, storage_path: path, status: "pending" })
        .select().single();
      if (dErr) throw dErr;

      toast.info("Extraction du texte…");
      const chunks = await extractPdfChunks(file);
      if (chunks.length === 0) throw new Error("PDF sans texte extractible");

      toast.info(`Indexation de ${chunks.length} extraits…`);
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/rag`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ documentId: doc.id, chunks }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Indexation échouée");

      toast.success(`Document indexé (${j.inserted} chunks)`);
      setFile(null); setTitle("");
      refresh();
    } catch (e: any) {
      console.error(e);
      toast.error(e.message ?? "Erreur");
    } finally {
      setUploading(false);
    }
  };

  const remove = async (d: Doc) => {
    if (!confirm(`Supprimer "${d.title}" ?`)) return;
    await supabase.from("documents").delete().eq("id", d.id);
    refresh();
  };

  return (
    <div className="px-4 md:px-8 py-6 md:py-8 max-w-4xl mx-auto space-y-6">
      <header>
        <p className="text-xs uppercase tracking-widest text-primary/80">Base de connaissances</p>
        <h1 className="font-display text-3xl md:text-4xl font-bold">Documents (RAG)</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Uploadez des PDFs (rapports, analyses…). Le chat IA pourra les citer en activant <strong>RAG</strong>.
        </p>
      </header>

      <div className="glass-card p-5 space-y-4">
        <Input placeholder="Titre du document" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="flex gap-2 items-center">
          <label className="flex-1 cursor-pointer flex items-center gap-2 p-3 border-2 border-dashed border-border rounded-lg hover:border-primary/50 transition-colors">
            <Upload className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground truncate">
              {file ? file.name : "Choisir un PDF (max 10 Mo)"}
            </span>
            <input type="file" accept="application/pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <Button onClick={upload} disabled={uploading || !file || !title}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Indexer"}
          </Button>
        </div>
      </div>

      <section className="space-y-2">
        {docs.length === 0 ? (
          <div className="glass-card p-10 text-center text-muted-foreground">
            <FileText className="h-10 w-10 mx-auto mb-2 opacity-50" />
            Aucun document
          </div>
        ) : docs.map((d) => (
          <div key={d.id} className="glass-card p-4 flex items-center gap-3">
            <FileText className="h-5 w-5 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{d.title}</div>
              <div className="text-xs text-muted-foreground">
                {new Date(d.created_at).toLocaleDateString("fr-FR")} ·{" "}
                {d.status === "ready" && <span className="text-bull inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />Prêt</span>}
                {d.status === "processing" && <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />Indexation</span>}
                {d.status === "error" && <span className="text-bear inline-flex items-center gap-1"><AlertCircle className="h-3 w-3" />Erreur</span>}
                {d.status === "pending" && "En attente"}
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => remove(d)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </section>
    </div>
  );
}
