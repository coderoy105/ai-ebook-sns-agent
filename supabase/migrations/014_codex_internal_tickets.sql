begin;

create table if not exists public.codex_internal_tickets (
  ticket_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.codex_internal_tickets enable row level security;
revoke all on public.codex_internal_tickets from anon, authenticated;

drop policy if exists codex_internal_tickets_client_deny on public.codex_internal_tickets;
create policy codex_internal_tickets_client_deny
on public.codex_internal_tickets
for all
to anon, authenticated
using (false)
with check (false);

create index if not exists codex_internal_tickets_expires_at_idx
  on public.codex_internal_tickets(expires_at);

create or replace function public.consume_codex_internal_ticket(p_ticket_hash text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  resolved_user_id uuid;
begin
  if p_ticket_hash is null or length(p_ticket_hash) <> 64 then
    return null;
  end if;

  delete from public.codex_internal_tickets
  where ticket_hash = p_ticket_hash
    and expires_at > now()
  returning user_id into resolved_user_id;

  delete from public.codex_internal_tickets where expires_at <= now();
  return resolved_user_id;
end;
$$;

revoke all on function public.consume_codex_internal_ticket(text) from public, anon, authenticated;
grant execute on function public.consume_codex_internal_ticket(text) to service_role;

commit;
