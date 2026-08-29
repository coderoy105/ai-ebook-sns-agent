begin;

-- Codex managed OAuth credentials now live exclusively in each user's
-- persistent CODEX_HOME on the Codex Worker. Supabase keeps connection
-- metadata only; it must not store access/refresh tokens or auth.json.
delete from public.ai_provider_credentials
where provider = 'codex_chatgpt';

drop function if exists public.store_codex_chatgpt_credential(uuid,text,text,text,boolean,jsonb);
drop function if exists public.has_codex_chatgpt_credential(uuid);
drop function if exists public.get_codex_chatgpt_credential(uuid);
drop function if exists public.delete_codex_chatgpt_credential(uuid);

alter table public.ai_provider_credentials
  drop constraint if exists ai_provider_credentials_provider_check;

alter table public.ai_provider_credentials
  add constraint ai_provider_credentials_provider_check
  check (provider = 'openrouter');

comment on table public.codex_connection_profiles is
  'Non-secret AI Book Studio Codex connection metadata. OAuth credentials remain only in the per-user CODEX_HOME on the persistent worker.';

commit;
