-- AI Book Studio security hardening applied after initial schema setup.
-- Keep trigger helpers out of the exposed RPC surface and pin search_path.

alter function public.touch_updated_at() set search_path = public;
revoke all on function public.populate_job_log_book_id() from public, anon, authenticated;
