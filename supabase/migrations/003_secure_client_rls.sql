-- Lock down AI Book Studio support tables that are exposed through PostgREST.

alter table public.rate_limit_buckets enable row level security;
drop policy if exists rate_limit_client_deny on public.rate_limit_buckets;
create policy rate_limit_client_deny
on public.rate_limit_buckets
for all
to anon, authenticated
using (false)
with check (false);

alter table public.plans enable row level security;
drop policy if exists plans_public_read on public.plans;
create policy plans_public_read
on public.plans
for select
to anon, authenticated
using (true);

alter table public.subscriptions enable row level security;
drop policy if exists subscriptions_owner_read on public.subscriptions;
create policy subscriptions_owner_read
on public.subscriptions
for select
to authenticated
using ((select auth.uid()) = user_id);
