begin;

alter table public.ai_provider_credentials
  drop constraint if exists ai_provider_credentials_provider_check;

alter table public.ai_provider_credentials
  add constraint ai_provider_credentials_provider_check
  check (provider in ('openrouter', 'codex_chatgpt'));

create or replace function public.store_codex_chatgpt_credential(
  p_user_id uuid,
  p_auth_json text,
  p_email text default null,
  p_plan_type text default null,
  p_model_available boolean default null,
  p_rate_limits jsonb default null
)
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
  if p_auth_json is null or length(trim(p_auth_json)) < 32 then raise exception 'INVALID_CODEX_AUTH'; end if;
  perform trim(p_auth_json)::jsonb;

  select c.vault_secret_id into existing_id
  from public.ai_provider_credentials c
  where c.user_id = p_user_id and c.provider = 'codex_chatgpt';

  if existing_id is null then
    secret_id := vault.create_secret(
      trim(p_auth_json),
      'ai_book_codex_chatgpt_' || p_user_id::text,
      'AI Book Studio Codex ChatGPT auth.json for Vercel fallback'
    );
    insert into public.ai_provider_credentials(user_id, provider, vault_secret_id)
    values (p_user_id, 'codex_chatgpt', secret_id)
    on conflict (user_id, provider) do update
      set vault_secret_id = excluded.vault_secret_id, updated_at = now();
  else
    perform vault.update_secret(
      existing_id,
      trim(p_auth_json),
      'ai_book_codex_chatgpt_' || p_user_id::text,
      'AI Book Studio Codex ChatGPT auth.json for Vercel fallback'
    );
    secret_id := existing_id;
    update public.ai_provider_credentials
      set updated_at = now()
      where user_id = p_user_id and provider = 'codex_chatgpt';
  end if;

  insert into public.codex_connection_profiles(
    user_id, email, plan_type, selected_model, model_available, rate_limits, connected_at, updated_at
  ) values (
    p_user_id, p_email, p_plan_type, 'gpt-5.6-luna', p_model_available, p_rate_limits, now(), now()
  )
  on conflict (user_id) do update set
    email = excluded.email,
    plan_type = excluded.plan_type,
    selected_model = excluded.selected_model,
    model_available = excluded.model_available,
    rate_limits = excluded.rate_limits,
    updated_at = now();

  return secret_id;
end;
$$;

create or replace function public.has_codex_chatgpt_credential(p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public, vault, pg_temp
as $$
  select exists(
    select 1
    from public.ai_provider_credentials c
    join vault.secrets v on v.id = c.vault_secret_id
    where c.user_id = p_user_id and c.provider = 'codex_chatgpt'
  );
$$;

create or replace function public.get_codex_chatgpt_credential(p_user_id uuid)
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
  where c.user_id = p_user_id and c.provider = 'codex_chatgpt';

  if result is not null then
    update public.ai_provider_credentials
      set last_used_at = now()
      where user_id = p_user_id and provider = 'codex_chatgpt';
  end if;

  return result;
end;
$$;

create or replace function public.delete_codex_chatgpt_credential(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  secret_id uuid;
begin
  delete from public.ai_provider_credentials
  where user_id = p_user_id and provider = 'codex_chatgpt'
  returning vault_secret_id into secret_id;

  delete from public.codex_connection_profiles where user_id = p_user_id;

  if secret_id is null then return false; end if;
  delete from vault.secrets where id = secret_id;
  return true;
end;
$$;

revoke all on function public.store_codex_chatgpt_credential(uuid,text,text,text,boolean,jsonb) from public, anon, authenticated;
revoke all on function public.has_codex_chatgpt_credential(uuid) from public, anon, authenticated;
revoke all on function public.get_codex_chatgpt_credential(uuid) from public, anon, authenticated;
revoke all on function public.delete_codex_chatgpt_credential(uuid) from public, anon, authenticated;

grant execute on function public.store_codex_chatgpt_credential(uuid,text,text,text,boolean,jsonb) to service_role;
grant execute on function public.has_codex_chatgpt_credential(uuid) to service_role;
grant execute on function public.get_codex_chatgpt_credential(uuid) to service_role;
grant execute on function public.delete_codex_chatgpt_credential(uuid) to service_role;

comment on table public.codex_connection_profiles is
  'Codex connection metadata. When no persistent worker is configured, auth.json is stored encrypted in Supabase Vault and restored into a Vercel /tmp CODEX_HOME per request.';

commit;
