begin;

-- Codex OAuth credentials must live only in the persistent per-user CODEX_HOME
-- owned by the dedicated Codex Worker. Remove the temporary Vercel/Vault
-- fallback and any one-time internal tickets used by that fallback.
with removed as (
  delete from public.ai_provider_credentials
  where provider = 'codex_chatgpt'
  returning vault_secret_id
)
delete from vault.secrets
where id in (select vault_secret_id from removed where vault_secret_id is not null);

drop function if exists public.store_codex_chatgpt_credential(uuid,text,text,text,boolean,jsonb);
drop function if exists public.has_codex_chatgpt_credential(uuid);
drop function if exists public.get_codex_chatgpt_credential(uuid);
drop function if exists public.delete_codex_chatgpt_credential(uuid);
drop function if exists public.consume_codex_internal_ticket(text);

drop table if exists public.codex_internal_tickets;

alter table public.ai_provider_credentials
  drop constraint if exists ai_provider_credentials_provider_check;

alter table public.ai_provider_credentials
  add constraint ai_provider_credentials_provider_check
  check (provider = 'openrouter');

comment on table public.codex_connection_profiles is
  'Non-secret AI Book Studio Codex connection metadata. OAuth credentials remain only in the per-user CODEX_HOME on the persistent worker.';

commit;
