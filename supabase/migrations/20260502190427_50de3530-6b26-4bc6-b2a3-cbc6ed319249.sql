-- Enable pgvector for RAG embeddings
create extension if not exists vector;

-- =========================================
-- PROFILES
-- =========================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create policy "Users view own profile" on public.profiles
  for select using (auth.uid() = id);
create policy "Users update own profile" on public.profiles
  for update using (auth.uid() = id);
create policy "Users insert own profile" on public.profiles
  for insert with check (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =========================================
-- WATCHLIST
-- =========================================
create table public.watchlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null,
  stock_name text,
  created_at timestamptz not null default now(),
  unique (user_id, ticker)
);
alter table public.watchlist enable row level security;

create policy "Users view own watchlist" on public.watchlist
  for select using (auth.uid() = user_id);
create policy "Users insert own watchlist" on public.watchlist
  for insert with check (auth.uid() = user_id);
create policy "Users delete own watchlist" on public.watchlist
  for delete using (auth.uid() = user_id);

-- =========================================
-- CONVERSATIONS + MESSAGES
-- =========================================
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Nouvelle conversation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.conversations enable row level security;

create policy "Users view own conversations" on public.conversations
  for select using (auth.uid() = user_id);
create policy "Users insert own conversations" on public.conversations
  for insert with check (auth.uid() = user_id);
create policy "Users update own conversations" on public.conversations
  for update using (auth.uid() = user_id);
create policy "Users delete own conversations" on public.conversations
  for delete using (auth.uid() = user_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  image_url text,
  created_at timestamptz not null default now()
);
alter table public.messages enable row level security;

create policy "Users view own messages" on public.messages
  for select using (auth.uid() = user_id);
create policy "Users insert own messages" on public.messages
  for insert with check (auth.uid() = user_id);
create policy "Users delete own messages" on public.messages
  for delete using (auth.uid() = user_id);

create index messages_conv_idx on public.messages(conversation_id, created_at);

-- =========================================
-- RAG : DOCUMENTS + CHUNKS
-- =========================================
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  storage_path text not null,
  status text not null default 'pending' check (status in ('pending','processing','ready','error')),
  error_message text,
  created_at timestamptz not null default now()
);
alter table public.documents enable row level security;

create policy "Users view own documents" on public.documents
  for select using (auth.uid() = user_id);
create policy "Users insert own documents" on public.documents
  for insert with check (auth.uid() = user_id);
create policy "Users update own documents" on public.documents
  for update using (auth.uid() = user_id);
create policy "Users delete own documents" on public.documents
  for delete using (auth.uid() = user_id);

create table public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  chunk_index int not null,
  content text not null,
  embedding vector(768),
  created_at timestamptz not null default now()
);
alter table public.document_chunks enable row level security;

create policy "Users view own chunks" on public.document_chunks
  for select using (auth.uid() = user_id);
create policy "Users insert own chunks" on public.document_chunks
  for insert with check (auth.uid() = user_id);
create policy "Users delete own chunks" on public.document_chunks
  for delete using (auth.uid() = user_id);

create index doc_chunks_doc_idx on public.document_chunks(document_id);
create index doc_chunks_embedding_idx on public.document_chunks
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Vector search function
create or replace function public.match_chunks(
  query_embedding vector(768),
  match_count int default 5,
  p_user_id uuid default null
)
returns table (
  id uuid,
  document_id uuid,
  content text,
  similarity float
)
language sql
stable
security definer
set search_path = public
as $$
  select
    dc.id,
    dc.document_id,
    dc.content,
    1 - (dc.embedding <=> query_embedding) as similarity
  from public.document_chunks dc
  where (p_user_id is null or dc.user_id = p_user_id)
    and dc.embedding is not null
  order by dc.embedding <=> query_embedding
  limit match_count;
$$;

-- =========================================
-- STORAGE BUCKETS
-- =========================================
insert into storage.buckets (id, name, public) values ('chat-images', 'chat-images', true);
insert into storage.buckets (id, name, public) values ('rag-pdfs', 'rag-pdfs', false);

-- chat-images: public read, user-scoped write
create policy "Public read chat images" on storage.objects
  for select using (bucket_id = 'chat-images');
create policy "Users upload own chat images" on storage.objects
  for insert with check (
    bucket_id = 'chat-images' and auth.uid()::text = (storage.foldername(name))[1]
  );
create policy "Users delete own chat images" on storage.objects
  for delete using (
    bucket_id = 'chat-images' and auth.uid()::text = (storage.foldername(name))[1]
  );

-- rag-pdfs: fully private
create policy "Users read own pdfs" on storage.objects
  for select using (
    bucket_id = 'rag-pdfs' and auth.uid()::text = (storage.foldername(name))[1]
  );
create policy "Users upload own pdfs" on storage.objects
  for insert with check (
    bucket_id = 'rag-pdfs' and auth.uid()::text = (storage.foldername(name))[1]
  );
create policy "Users delete own pdfs" on storage.objects
  for delete using (
    bucket_id = 'rag-pdfs' and auth.uid()::text = (storage.foldername(name))[1]
  );