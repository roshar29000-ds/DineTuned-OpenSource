-- Additive foundation. No data imports, deletes, destructive resets or shared
-- restaurant tables. Run once through Supabase migration history, in order.
begin;
create schema if not exists dinetuned_private;
revoke all on schema dinetuned_private from public, anon, authenticated;

create table public.taste_profiles (
  id uuid not null default gen_random_uuid() unique,
  user_id uuid primary key default auth.uid() references auth.users(id),
  document jsonb not null check (
    jsonb_typeof(document) = 'object' and octet_length(document::text) <= 65536
    and document ?& array['profile','evidence','detective','edited_axes','exploration_edited']
    and jsonb_typeof(document->'profile') = 'object'
    and coalesce(document->'profile'->>'schema_version' = '2', false)
    and jsonb_typeof(document->'evidence') = 'object'
    and jsonb_typeof(document->'edited_axes') = 'array'
    and jsonb_typeof(document->'exploration_edited') = 'boolean'
  ),
  revision integer not null default 1 check (revision > 0),
  source text not null default 'user_reported' check (source = 'user_reported'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.recommendation_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  session_id text not null check (length(session_id) between 1 and 100),
  restaurant_id text not null check (restaurant_id ~ '^[a-zA-Z0-9_-]{1,100}$'),
  menu_version text not null check (menu_version ~ '^[a-zA-Z0-9_-]{1,100}$'),
  dishes jsonb not null check (jsonb_typeof(dishes) = 'array' and jsonb_array_length(dishes) <= 5 and octet_length(dishes::text) <= 16384),
  reported_provider text not null check (length(reported_provider) between 1 and 100),
  source text not null default 'user_reported' check (source = 'user_reported'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  unique (user_id, session_id)
);

create table public.dining_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  event_type text not null check (event_type in ('saved','selected','ordered','tasted')),
  restaurant_id text not null check (restaurant_id ~ '^[a-zA-Z0-9_-]{1,100}$'),
  menu_version text not null check (menu_version ~ '^[a-zA-Z0-9_-]{1,100}$'),
  dish_id text not null check (dish_id ~ '^[a-zA-Z0-9_-]{1,100}$'),
  occurred_at timestamptz not null,
  recommendation_id uuid,
  source text not null default 'user_reported' check (source = 'user_reported'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  foreign key (user_id, recommendation_id) references public.recommendation_history(user_id, id)
);

create table public.dish_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  event_id uuid,
  feedback jsonb not null check (
    jsonb_typeof(feedback) = 'object' and octet_length(feedback::text) <= 8192
    and feedback ?& array['id','restaurant_name','dish_id','dish_name','liked','note','date']
    and jsonb_typeof(feedback->'liked') = 'boolean'
    and length(feedback->>'note') <= 1000
  ),
  rating integer check (rating between 1 and 5),
  tags text[] not null default '{}' check (cardinality(tags) <= 7 and tags <@ array[
    'too_spicy','not_spicy_enough','too_rich','too_heavy','great_texture','disliked_texture','would_order_again']),
  source text not null default 'user_reported' check (source = 'user_reported'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (user_id, event_id) references public.dining_events(user_id, id)
);
create unique index dish_feedback_user_client_id on public.dish_feedback (user_id, (feedback->>'id'));
create index recommendation_history_user_recent on public.recommendation_history(user_id, created_at desc, id desc);
create index dining_events_user_recent on public.dining_events(user_id, occurred_at desc, id desc);
create index dining_events_user_recommendation on public.dining_events(user_id, recommendation_id);
create index dish_feedback_user_recent on public.dish_feedback(user_id, created_at desc, id desc);
create index dish_feedback_user_event on public.dish_feedback(user_id, event_id);

create function dinetuned_private.stamp_record() returns trigger language plpgsql
set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := statement_timestamp();
  else
    if new.user_id <> old.user_id or new.id <> old.id then
      raise exception 'Record identity is immutable';
    end if;
    new.created_at := old.created_at;
  end if;
  new.updated_at := statement_timestamp();
  return new;
end;
$$;
create function dinetuned_private.profile_revision() returns trigger language plpgsql
set search_path = '' as $$
begin
  if tg_op = 'INSERT' then new.revision := 1;
  else new.revision := old.revision + 1;
  end if;
  return new;
end;
$$;
revoke all on function dinetuned_private.stamp_record() from public, anon, authenticated;
revoke all on function dinetuned_private.profile_revision() from public, anon, authenticated;

create trigger profile_revision before insert or update on public.taste_profiles
for each row execute function dinetuned_private.profile_revision();

-- All exposed tables require a verified Auth identity, including anonymous
-- signed-in users. An unauthenticated `anon` database role has no table grants.
do $$
declare table_name text;
begin
  foreach table_name in array array['taste_profiles','recommendation_history','dining_events','dish_feedback'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant select, insert on table public.%I to authenticated', table_name);
    execute format('create policy own_select on public.%I for select to authenticated using ((select auth.uid()) = user_id)', table_name);
    execute format('create policy own_insert on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', table_name);
    execute format('create trigger stamp_record before insert or update on public.%I for each row execute function dinetuned_private.stamp_record()', table_name);
  end loop;
end;
$$;
grant update (document) on public.taste_profiles to authenticated;
create policy own_update on public.taste_profiles for update to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

comment on table public.recommendation_history is 'Private user-reported recommendation provenance, not verified model inference. Future shared restaurant/menu caches belong in separate tables.';
comment on table public.taste_profiles is 'Private versioned Taste DNA backup. Never implicitly overwrite browser preferences.';
commit;
