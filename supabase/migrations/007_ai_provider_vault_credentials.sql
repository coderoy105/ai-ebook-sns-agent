create table if not exists public.ai_provider_credentials (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  vault_secret_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz,
  primary key (user_id, provider),
  constraint ai_provider_credentials_provider_check check (provider in ('openrouter'))
);

alter table public.ai_provider_credentials enable row level security;
revoke all on public.ai_provider_credentials from anon, authenticated;

create or replace function public.store_openrouter_credential(p_user_id uuid, p_secret text)
returns uuid
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  existing_id uuid;
  secret_id uuid;
begin
  if p_user_id is null then raise exception 'USER_REQUIRED'; end if;
  if p_secret is null or length(trim(p_secret)) < 16 then raise exception 'INVALID_OPENROUTER_KEY'; end if;

  select c.vault_secret_id into existing_id
  from public.ai_provider_credentials c
  where c.user_id = p_user_id and c.provider = 'openrouter';

  if existing_id is null then
    secret_id := vault.create_secret(
      trim(p_secret),
      'ai_book_openrouter_' || p_user_id::text,
      'AI Book Studio OpenRouter OAuth key'
    );
    insert into public.ai_provider_credentials(user_id, provider, vault_secret_id)
    values (p_user_id, 'openrouter', secret_id)
    on conflict (user_id, provider) do update
      set vault_secret_id = excluded.vault_secret_id, updated_at = now();
  else
    perform vault.update_secret(
      existing_id,
      trim(p_secret),
      'ai_book_openrouter_' || p_user_id::text,
      'AI Book Studio OpenRouter OAuth key'
    );
    secret_id := existing_id;
    update public.ai_provider_credentials
      set updated_at = now()
      where user_id = p_user_id and provider = 'openrouter';
  end if;

  return secret_id;
end;
$$;

create or replace function public.has_openrouter_credential(p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public, vault, pg_temp
as $$
  select exists(
    select 1
    from public.ai_provider_credentials c
    join vault.secrets v on v.id = c.vault_secret_id
    where c.user_id = p_user_id and c.provider = 'openrouter'
  );
$$;

create or replace function public.get_openrouter_credential(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  result text;
begin
  select v.decrypted_secret into result
  from public.ai_provider_credentials c
  join vault.decrypted_secrets v on v.id = c.vault_secret_id
  where c.user_id = p_user_id and c.provider = 'openrouter';

  if result is not null then
    update public.ai_provider_credentials
      set last_used_at = now()
      where user_id = p_user_id and provider = 'openrouter';
  end if;

  return result;
end;
$$;

create or replace function public.delete_openrouter_credential(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  secret_id uuid;
begin
  delete from public.ai_provider_credentials
  where user_id = p_user_id and provider = 'openrouter'
  returning vault_secret_id into secret_id;

  if secret_id is null then return false; end if;
  delete from vault.secrets where id = secret_id;
  return true;
end;
$$;

revoke all on function public.store_openrouter_credential(uuid,text) from public, anon, authenticated;
revoke all on function public.has_openrouter_credential(uuid) from public, anon, authenticated;
revoke all on function public.get_openrouter_credential(uuid) from public, anon, authenticated;
revoke all on function public.delete_openrouter_credential(uuid) from public, anon, authenticated;
grant execute on function public.store_openrouter_credential(uuid,text) to service_role;
grant execute on function public.has_openrouter_credential(uuid) to service_role;
grant execute on function public.get_openrouter_credential(uuid) to service_role;
grant execute on function public.delete_openrouter_credential(uuid) to service_role;
