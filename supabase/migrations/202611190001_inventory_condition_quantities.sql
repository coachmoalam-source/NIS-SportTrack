-- Preserve stock totals while adding explicit condition breakdown for imports.
alter table public.inventory
  add column if not exists new_quantity integer not null default 0,
  add column if not exists used_quantity integer not null default 0;

alter table public.inventory_import_aliases
  drop constraint if exists inventory_import_aliases_canonical_field_check;

alter table public.inventory_import_aliases
  add constraint inventory_import_aliases_canonical_field_check
  check (canonical_field = any (array[
    'item_name','item_code','category','quantity','new_quantity',
    'used_quantity','damaged_quantity','missing_quantity','unit','notes'
  ]::text[]);

update public.inventory_import_aliases
set canonical_field = 'used_quantity',
    canonical_label = 'Used quantity',
    normalized_alias = 'used',
    language = 'en'
where lower(alias) = 'used';

insert into public.inventory_import_aliases
  (canonical_field, canonical_label, alias, normalized_alias, language, is_active)
values
  ('item_name','Item name','Tools','tools','en',true),
  ('new_quantity','New quantity','New','new','en',true),
  ('new_quantity','New quantity','الجديد','الجديد','ar',true),
  ('used_quantity','Used quantity','Used','used','en',true),
  ('used_quantity','Used quantity','المستعمل','المستعمل','ar',true),
  ('damaged_quantity','Damaged quantity','Damage','damage','en',true)
on conflict (normalized_alias) do update
set canonical_field = excluded.canonical_field,
    canonical_label = excluded.canonical_label,
    alias = excluded.alias,
    language = excluded.language,
    is_active = true;
