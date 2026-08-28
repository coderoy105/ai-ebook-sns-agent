-- Keep pgvector out of the exposed public schema while preserving existing vector columns and indexes.
create schema if not exists extensions;
alter extension vector set schema extensions;
alter function public.match_book_memory(extensions.vector, uuid, integer, double precision)
  set search_path = public, extensions;
