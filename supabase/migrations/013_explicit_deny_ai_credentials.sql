begin;

drop policy if exists ai_provider_credentials_client_deny on public.ai_provider_credentials;
create policy ai_provider_credentials_client_deny
on public.ai_provider_credentials
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists codex_connection_profiles_client_deny on public.codex_connection_profiles;
create policy codex_connection_profiles_client_deny
on public.codex_connection_profiles
for all
to anon, authenticated
using (false)
with check (false);

commit;
