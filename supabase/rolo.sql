-- Rolo sync: run once in the Supabase SQL editor of the project shared with Duo Logo and DuoVino.
-- Rolo keeps its own tables and functions (rolo_*), separate from the duologo_* and duovino_* ones.
-- The login is never stored: the app sends only a SHA-256 hash of "rolo:" + the normalised login.
-- Tables have row-level security turned on with NO policies, so they can only be reached
-- through the security-definer functions below.

create table if not exists public.rolo_accounts (
  key         text primary key check (key ~ '^[0-9a-f]{64}$'),
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

create table if not exists public.rolo_photos (
  key        text not null references public.rolo_accounts(key) on delete cascade,
  person_id  text not null check (length(person_id) <= 40),
  data       text not null check (length(data) <= 600000),   -- compressed JPEG data URL, ~30-60 KB
  updated    bigint not null,
  primary key (key, person_id)
);

alter table public.rolo_accounts enable row level security;
alter table public.rolo_photos   enable row level security;
revoke all on public.rolo_accounts, public.rolo_photos from anon, authenticated;

-- Load an orbit (null if the combination doesn't exist yet)
create or replace function public.rolo_load(p_key text)
returns jsonb language sql stable security definer set search_path = public as $$
  select data from public.rolo_accounts where key = p_key
$$;

-- Create or replace an orbit
create or replace function public.rolo_save(p_key text, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_key !~ '^[0-9a-f]{64}$' then raise exception 'invalid key'; end if;
  if octet_length(p_data::text) > 5000000 then raise exception 'orbit too large'; end if;
  insert into public.rolo_accounts(key, data, updated_at) values (p_key, p_data, now())
  on conflict (key) do update set data = excluded.data, updated_at = now();
end $$;

-- Remove an orbit and its photos (used when changing planet & constellation)
create or replace function public.rolo_delete(p_key text)
returns void language sql security definer set search_path = public as $$
  delete from public.rolo_accounts where key = p_key
$$;

-- Photos: listed with timestamps, fetched one at a time, put (or deleted when p_data is null)
create or replace function public.rolo_photo_list(p_key text)
returns table(person_id text, updated bigint) language sql stable security definer set search_path = public as $$
  select person_id, updated from public.rolo_photos where key = p_key
$$;

create or replace function public.rolo_photo_get(p_key text, p_person text)
returns text language sql stable security definer set search_path = public as $$
  select data from public.rolo_photos where key = p_key and person_id = p_person
$$;

create or replace function public.rolo_photo_put(p_key text, p_person text, p_data text, p_updated bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.rolo_accounts where key = p_key) then raise exception 'unknown orbit'; end if;
  if p_data is null then
    delete from public.rolo_photos where key = p_key and person_id = p_person;
  else
    insert into public.rolo_photos(key, person_id, data, updated) values (p_key, p_person, p_data, p_updated)
    on conflict (key, person_id) do update set data = excluded.data, updated = excluded.updated
    where public.rolo_photos.updated <= excluded.updated;
  end if;
end $$;

revoke all on function public.rolo_load(text), public.rolo_save(text, jsonb), public.rolo_delete(text),
  public.rolo_photo_list(text), public.rolo_photo_get(text, text), public.rolo_photo_put(text, text, text, bigint) from public;
grant execute on function public.rolo_load(text), public.rolo_save(text, jsonb), public.rolo_delete(text),
  public.rolo_photo_list(text), public.rolo_photo_get(text, text), public.rolo_photo_put(text, text, text, bigint) to anon, authenticated;
