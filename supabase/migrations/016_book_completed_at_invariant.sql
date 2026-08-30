create or replace function public.ensure_book_completed_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'COMPLETED'::public.book_status and new.completed_at is null then
    new.completed_at := coalesce(
      (
        select max(gj.finished_at)
        from public.generation_jobs gj
        where gj.book_id = new.id
          and gj.status = 'COMPLETED'
      ),
      now()
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_books_completed_at on public.books;
create trigger trg_books_completed_at
before insert or update on public.books
for each row execute function public.ensure_book_completed_at();

update public.books b
set completed_at = coalesce(
  (
    select max(gj.finished_at)
    from public.generation_jobs gj
    where gj.book_id = b.id
      and gj.status = 'COMPLETED'
  ),
  b.updated_at,
  now()
)
where b.status = 'COMPLETED'
  and b.completed_at is null;
