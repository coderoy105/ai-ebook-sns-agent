-- Avoid re-evaluating auth.uid() for every scanned row in AI Book Studio RLS policies.
drop policy if exists books_owner_all on public.books;
create policy books_owner_all on public.books for all
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

do $$
declare t text;
begin
  foreach t in array array['book_settings','reader_profiles','writing_styles','book_blueprints','parts','chapters','sections','content_blocks','story_bibles','knowledge_maps','book_memories','sources','citations','pages','book_reviews','book_covers']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_owner_all', t);
    execute format(
      'create policy %I on public.%I for all using (exists (select 1 from public.books b where b.id = %I.book_id and b.user_id = (select auth.uid()))) with check (exists (select 1 from public.books b where b.id = %I.book_id and b.user_id = (select auth.uid())))',
      t || '_owner_all', t, t, t
    );
  end loop;
end $$;

drop policy if exists revisions_owner_all on public.revisions;
create policy revisions_owner_all on public.revisions for all
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists generation_jobs_owner_all on public.generation_jobs;
create policy generation_jobs_owner_all on public.generation_jobs for all
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists generation_steps_owner_read on public.generation_steps;
create policy generation_steps_owner_read on public.generation_steps for select
using (exists (select 1 from public.books b where b.id = book_id and b.user_id = (select auth.uid())));

drop policy if exists job_logs_owner_read on public.job_logs;
create policy job_logs_owner_read on public.job_logs for select
using (exists (select 1 from public.books b where b.id = book_id and b.user_id = (select auth.uid())));

drop policy if exists token_usage_owner_read on public.token_usage;
create policy token_usage_owner_read on public.token_usage for select
using (user_id = (select auth.uid()));

drop policy if exists assets_owner_all on public.assets;
create policy assets_owner_all on public.assets for all
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists export_jobs_owner_all on public.export_jobs;
create policy export_jobs_owner_all on public.export_jobs for all
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));
