create extension if not exists vector;
create extension if not exists pgcrypto;

create type public.book_status as enum ('DRAFT','PLANNING','GENERATING','PAUSED','REVIEWING','COMPLETED','FAILED','CANCELLED');
create type public.content_status as enum ('PLANNED','GENERATING','COMPLETED','FAILED');
create type public.job_status as enum ('QUEUED','PLANNING','RESEARCHING','GENERATING','REVIEWING','REWRITING','COMPLETED','FAILED','RETRYING','PAUSED','CANCELLED');

create table public.books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  subtitle text,
  idea text not null,
  book_type text not null,
  book_family text not null,
  status public.book_status not null default 'DRAFT',
  target_pages int not null check (target_pages between 1 and 1000),
  target_words int not null check (target_words > 0),
  progress numeric(5,2) not null default 0 check (progress between 0 and 100),
  current_section_id uuid,
  quality_score numeric(5,2),
  quality_scores jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.book_settings (
  book_id uuid primary key references public.books(id) on delete cascade,
  target_pages int not null,
  target_words int not null,
  template_id text default 'modern-editorial',
  chapter_count int,
  creativity int not null default 6 check (creativity between 1 and 10),
  research_depth int not null default 5 check (research_depth between 0 and 10),
  writing_density int not null default 6 check (writing_density between 1 and 10),
  sentence_length int not null default 6 check (sentence_length between 1 and 10),
  vocabulary_level int not null default 5 check (vocabulary_level between 1 and 10),
  examples_frequency int not null default 5 check (examples_frequency between 0 and 10),
  citation_level text not null default 'standard',
  image_frequency int not null default 3 check (image_frequency between 0 and 10),
  narrative_level int not null default 5 check (narrative_level between 0 and 10),
  technical_depth int not null default 5 check (technical_depth between 0 and 10),
  created_at timestamptz not null default now()
);

create table public.reader_profiles (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null unique references public.books(id) on delete cascade,
  age_group text not null,
  knowledge_level text not null,
  reading_purpose text not null,
  preferred_complexity int not null,
  tone_preference text not null,
  technical_tolerance int not null,
  example_preference text not null,
  reading_speed text not null
);

create table public.writing_styles (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null unique references public.books(id) on delete cascade,
  label text not null,
  description text not null,
  sentence_length int not null,
  description_depth int not null,
  emotion_level int not null,
  technical_vocabulary int not null,
  dialogue_ratio int not null,
  narrative_speed int not null
);

create table public.book_blueprints (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  blueprint jsonb not null,
  version int not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.parts (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  position int not null,
  title text not null,
  purpose text,
  created_at timestamptz not null default now(),
  unique(book_id, position)
);

create table public.chapters (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  part_id uuid references public.parts(id) on delete cascade,
  position int not null,
  title text not null,
  goal text,
  target_words int not null default 1000,
  word_count int not null default 0,
  summary text,
  dependencies jsonb not null default '[]'::jsonb,
  status public.content_status not null default 'PLANNED',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sections (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  position int not null,
  title text not null,
  goal text,
  target_words int not null default 500,
  word_count int not null default 0,
  research_needed boolean not null default false,
  layout_hint text,
  content_markdown text,
  summary text,
  status public.content_status not null default 'PLANNED',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(chapter_id, position)
);

alter table public.books add constraint books_current_section_fk foreign key (current_section_id) references public.sections(id) on delete set null;

create table public.content_blocks (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  section_id uuid not null references public.sections(id) on delete cascade,
  position int not null,
  block_type text not null,
  content jsonb not null,
  layout_hint text,
  created_at timestamptz not null default now()
);

create table public.story_bibles (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  data jsonb not null,
  version int not null default 1,
  created_at timestamptz not null default now()
);

create table public.knowledge_maps (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  data jsonb not null,
  version int not null default 1,
  created_at timestamptz not null default now()
);

create table public.book_memories (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  source_section_id uuid references public.sections(id) on delete cascade,
  memory_type text not null,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  embedding vector(1536),
  created_at timestamptz not null default now()
);
create index book_memories_book_idx on public.book_memories(book_id);
create index book_memories_embedding_idx on public.book_memories using hnsw (embedding vector_cosine_ops);

create or replace function public.match_book_memory(
  query_embedding vector(1536),
  match_book_id uuid,
  match_count int default 10,
  min_similarity float default 0.35
)
returns table(id uuid, memory_type text, content text, metadata jsonb, similarity float)
language sql stable security definer set search_path = public
as $$
  select bm.id, bm.memory_type, bm.content, bm.metadata,
    1 - (bm.embedding <=> query_embedding) as similarity
  from public.book_memories bm
  where bm.book_id = match_book_id and bm.embedding is not null
    and 1 - (bm.embedding <=> query_embedding) >= min_similarity
  order by bm.embedding <=> query_embedding
  limit match_count;
$$;

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  url text not null,
  title text,
  source_type text,
  reliability numeric(4,3),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(book_id, url)
);

create table public.citations (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  section_id uuid references public.sections(id) on delete cascade,
  source_id uuid not null references public.sources(id) on delete cascade,
  style text not null default 'URL',
  locator text,
  quote_excerpt text,
  created_at timestamptz not null default now()
);

create table public.templates (
  id text primary key,
  name text not null,
  genre text not null,
  design_dna jsonb not null,
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);

insert into public.templates (id,name,genre,design_dna,is_system) values
('modern-editorial','Modern Editorial','business','{"mood":"calm premium editorial","colors":["paper","charcoal","rust"],"spacing":"airy","chapterOpening":"oversized number + title"}',true),
('minimal-tech','Minimal Tech','technical','{"mood":"precise modern","colors":["white","ink","signal blue"],"spacing":"balanced","chapterOpening":"title + objective"}',true),
('quiet-fiction','Quiet Fiction','novel','{"mood":"literary immersive","colors":["warm white","ink"],"spacing":"airy","chapterOpening":"centered title"}',true)
on conflict do nothing;

create table public.pages (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  page_number int not null,
  layout_type text not null,
  template_id text references public.templates(id),
  content jsonb not null,
  created_at timestamptz not null default now(),
  unique(book_id,page_number)
);

create table public.revisions (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  section_id uuid references public.sections(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  revision_type text not null,
  title_before text,
  content_before text,
  instruction text,
  created_at timestamptz not null default now()
);

create table public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status public.job_status not null default 'QUEUED',
  progress numeric(5,2) not null default 0,
  workflow_run_id text,
  retry_count int not null default 0,
  failure_reason text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.generation_steps (
  id uuid primary key default gen_random_uuid(),
  generation_job_id uuid not null references public.generation_jobs(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  section_id uuid references public.sections(id) on delete cascade,
  step_type text not null,
  status text not null,
  attempt int not null default 1,
  output jsonb,
  error_message text,
  duration_ms int,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.job_logs (
  id uuid primary key default gen_random_uuid(),
  generation_job_id uuid not null references public.generation_jobs(id) on delete cascade,
  book_id uuid references public.books(id) on delete cascade,
  level text not null default 'info',
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index job_logs_book_idx on public.job_logs(book_id, created_at desc);

create or replace function public.populate_job_log_book_id()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  select book_id into new.book_id from public.generation_jobs where id = new.generation_job_id;
  return new;
end $$;
create trigger trg_job_logs_book before insert on public.job_logs
for each row execute function public.populate_job_log_book_id();

create table public.token_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid references public.books(id) on delete cascade,
  operation text not null,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  estimated_cost numeric(12,6) not null default 0,
  actual_cost numeric(12,6),
  duration_ms int,
  retry_count int not null default 0,
  provider_request_id text,
  created_at timestamptz not null default now()
);

create table public.book_reviews (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  generation_job_id uuid references public.generation_jobs(id) on delete set null,
  review jsonb not null,
  created_at timestamptz not null default now()
);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  asset_type text not null,
  storage_path text not null,
  mime_type text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.book_covers (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  concept jsonb not null default '{}'::jsonb,
  asset_id uuid references public.assets(id) on delete set null,
  is_selected boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.export_jobs (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  format text not null,
  status text not null default 'QUEUED',
  asset_id uuid references public.assets(id) on delete set null,
  error_message text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table public.rate_limit_buckets (
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket_key text not null,
  window_started_at timestamptz not null default now(),
  used int not null default 0,
  primary key(user_id, bucket_key)
);

create or replace function public.consume_rate_limit(
  p_user_id uuid,
  p_key text,
  p_limit int,
  p_window_seconds int
) returns boolean
language plpgsql security definer set search_path=public as $$
declare
  current_used int;
begin
  insert into public.rate_limit_buckets(user_id,bucket_key,window_started_at,used)
  values(p_user_id,p_key,now(),1)
  on conflict(user_id,bucket_key) do update set
    window_started_at = case when public.rate_limit_buckets.window_started_at < now() - make_interval(secs => p_window_seconds) then now() else public.rate_limit_buckets.window_started_at end,
    used = case when public.rate_limit_buckets.window_started_at < now() - make_interval(secs => p_window_seconds) then 1 else public.rate_limit_buckets.used + 1 end
  returning used into current_used;
  return current_used <= p_limit;
end $$;
revoke all on function public.consume_rate_limit(uuid,text,int,int) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(uuid,text,int,int) to service_role;

create table public.plans (
  code text primary key,
  name text not null,
  monthly_page_limit int,
  storage_mb int,
  research_enabled boolean not null default false,
  image_limit int not null default 0,
  model_tier text not null default 'standard',
  created_at timestamptz not null default now()
);
insert into public.plans(code,name,monthly_page_limit,storage_mb,research_enabled,image_limit,model_tier) values
('free','Free',30,100,false,0,'standard'),
('starter','Starter',300,1000,true,20,'standard'),
('pro','Pro',1500,10000,true,200,'premium')
on conflict do nothing;

create table public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan_code text not null references public.plans(code) default 'free',
  status text not null default 'active',
  provider text,
  provider_customer_id text,
  provider_subscription_id text,
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);

-- Updated-at helper
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger books_touch before update on public.books for each row execute function public.touch_updated_at();
create trigger sections_touch before update on public.sections for each row execute function public.touch_updated_at();
create trigger chapters_touch before update on public.chapters for each row execute function public.touch_updated_at();
create trigger generation_jobs_touch before update on public.generation_jobs for each row execute function public.touch_updated_at();

-- RLS: every client-visible project row must be owned by the authenticated user.
alter table public.books enable row level security;
create policy "books_owner_all" on public.books for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

do $$
declare t text;
begin
  foreach t in array array['book_settings','reader_profiles','writing_styles','book_blueprints','parts','chapters','sections','content_blocks','story_bibles','knowledge_maps','book_memories','sources','citations','pages','book_reviews','book_covers']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all using (exists (select 1 from public.books b where b.id = %I.book_id and b.user_id = auth.uid())) with check (exists (select 1 from public.books b where b.id = %I.book_id and b.user_id = auth.uid()))',
      t || '_owner_all', t, t, t
    );
  end loop;
end $$;

alter table public.revisions enable row level security;
create policy "revisions_owner_all" on public.revisions for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.generation_jobs enable row level security;
create policy "generation_jobs_owner_all" on public.generation_jobs for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.generation_steps enable row level security;
create policy "generation_steps_owner_read" on public.generation_steps for select using (exists (select 1 from public.books b where b.id = book_id and b.user_id = auth.uid()));

alter table public.job_logs enable row level security;
create policy "job_logs_owner_read" on public.job_logs for select using (exists (select 1 from public.books b where b.id = book_id and b.user_id = auth.uid()));

alter table public.token_usage enable row level security;
create policy "token_usage_owner_read" on public.token_usage for select using (user_id = auth.uid());

alter table public.assets enable row level security;
create policy "assets_owner_all" on public.assets for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.export_jobs enable row level security;
create policy "export_jobs_owner_all" on public.export_jobs for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.templates enable row level security;
create policy "templates_read" on public.templates for select using (is_system = true);

revoke all on function public.match_book_memory(vector, uuid, int, float) from public, anon, authenticated;
grant execute on function public.match_book_memory(vector, uuid, int, float) to service_role;
