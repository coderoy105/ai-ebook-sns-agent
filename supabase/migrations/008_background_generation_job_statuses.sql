alter type public.job_status add value if not exists 'WAITING_LIMIT';
alter type public.job_status add value if not exists 'NEEDS_RECONNECT';
alter type public.job_status add value if not exists 'PAUSED_ERROR';
