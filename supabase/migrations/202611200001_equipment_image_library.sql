-- Shared equipment image library: new equipment with the same normalized name
-- automatically inherits the reference photo, regardless of item_code.
create table if not exists public.equipment_image_map (
  id uuid primary key default gen_random_uuid(),
  normalized_name text not null unique,
  display_name text not null,
  photo_url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.equipment_image_map (normalized_name, display_name, photo_url)
select distinct on (lower(regexp_replace(trim(name), '\s+', ' ', 'g')))
  lower(regexp_replace(trim(name), '\s+', ' ', 'g')),
  trim(name),
  photo_url
from public.equipment
where photo_url is not null and photo_url <> ''
order by lower(regexp_replace(trim(name), '\s+', ' ', 'g')), created_at asc
on conflict (normalized_name) do nothing;

create or replace function public.set_equipment_photo_from_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  matched_photo text;
  normalized text;
begin
  if new.photo_url is not null and new.photo_url <> '' then
    return new;
  end if;
  normalized := lower(regexp_replace(trim(coalesce(new.name, '')), '\s+', ' ', 'g'));
  select photo_url into matched_photo
  from public.equipment_image_map
  where normalized_name = normalized
  limit 1;
  if matched_photo is not null then
    new.photo_url := matched_photo;
  end if;
  return new;
end;
$$;

create or replace function public.sync_equipment_photo_to_name_map()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized text;
begin
  if new.photo_url is null or new.photo_url = '' or new.name is null or trim(new.name) = '' then
    return new;
  end if;
  normalized := lower(regexp_replace(trim(new.name), '\s+', ' ', 'g'));
  insert into public.equipment_image_map (normalized_name, display_name, photo_url, updated_at)
  values (normalized, trim(new.name), new.photo_url, now())
  on conflict (normalized_name)
  do update set display_name = excluded.display_name,
                photo_url = excluded.photo_url,
                updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_equipment_photo_by_name on public.equipment;
create trigger trg_equipment_photo_by_name
before insert or update of name, photo_url on public.equipment
for each row execute function public.set_equipment_photo_from_name();

drop trigger if exists trg_sync_equipment_photo_to_name_map on public.equipment;
create trigger trg_sync_equipment_photo_to_name_map
after insert or update of name, photo_url on public.equipment
for each row execute function public.sync_equipment_photo_to_name_map();
