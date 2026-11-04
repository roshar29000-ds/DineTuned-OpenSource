-- Step 4D.2B. Incremental migration; does not change existing Taste DNA backups.
-- Apply only after review/approval. No existing rows are deleted.
begin;
alter table public.dining_events
  add column restaurant_name text check (length(restaurant_name) between 1 and 200),
  add column dish_name text check (length(dish_name) between 1 and 200),
  add column revision integer not null default 1 check (revision > 0);
alter table public.dish_feedback
  add column revision integer not null default 1 check (revision > 0);

-- Reuse the existing server-owned revision trigger. Owners cannot write revisions.
create trigger dining_revision before insert or update on public.dining_events
for each row execute function dinetuned_private.profile_revision();
create trigger feedback_revision before insert or update on public.dish_feedback
for each row execute function dinetuned_private.profile_revision();

grant update (event_type) on public.dining_events to authenticated;
grant update (feedback, rating, tags) on public.dish_feedback to authenticated;
grant delete on public.dining_events, public.dish_feedback to authenticated;
create policy own_update on public.dining_events for update to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy own_delete on public.dining_events for delete to authenticated
using ((select auth.uid()) = user_id);
create policy own_update on public.dish_feedback for update to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy own_delete on public.dish_feedback for delete to authenticated
using ((select auth.uid()) = user_id);

-- Keep feedback identity and provenance immutable even through direct PostgREST.
create function dinetuned_private.feedback_provenance() returns trigger language plpgsql
set search_path = '' as $$
begin
  if (new.feedback - array['liked','note']) is distinct from (old.feedback - array['liked','note']) then
    raise exception 'Feedback provenance is immutable';
  end if;
  return new;
end;
$$;
revoke all on function dinetuned_private.feedback_provenance() from public, anon, authenticated;
create trigger feedback_provenance before update on public.dish_feedback
for each row execute function dinetuned_private.feedback_provenance();
-- Existing foreign keys deliberately require deleting linked feedback before an event.
commit;
