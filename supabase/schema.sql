-- NIS SportTrack database schema
-- Run this file in Supabase Dashboard > SQL Editor.
-- Branches: five current NIS locations. Add a branch here if the school confirms another location.

create extension if not exists pgcrypto;

create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

insert into public.branches (name) values
  ('El Shorouk'),
  ('O West'),
  ('New Capital'),
  ('El Tagamoa'),
  ('Porto Said')
on conflict (name) do nothing;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null default 'branch_admin'
    check (role in ('central_admin', 'branch_admin', 'viewer')),
  branch_id uuid references public.branches(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_branch_role_check
    check (role = 'central_admin' or branch_id is not null)
);

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete restrict,
  item_code text,
  item_name text not null,
  category text,
  quantity integer not null default 0 check (quantity >= 0),
  damaged_quantity integer not null default 0 check (damaged_quantity >= 0),
  missing_quantity integer not null default 0 check (missing_quantity >= 0),
  unit text not null default 'قطعة',
  image_url text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_quantities_valid
    check (damaged_quantity + missing_quantity <= quantity),
  constraint inventory_code_per_branch_unique
    unique (branch_id, item_code)
);

create table if not exists public.inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete restrict,
  item_id uuid references public.inventory_items(id) on delete set null,
  transaction_type text not null
    check (transaction_type in ('receive', 'issue', 'damage', 'loss', 'adjustment')),
  quantity integer not null check (quantity > 0),
  notes text,
  performed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists inventory_items_branch_idx on public.inventory_items(branch_id);
create index if not exists inventory_items_name_idx on public.inventory_items(item_name);
create index if not exists inventory_transactions_branch_date_idx on public.inventory_transactions(branch_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists inventory_items_set_updated_at on public.inventory_items;
create trigger inventory_items_set_updated_at before update on public.inventory_items
for each row execute function public.set_updated_at();

-- Security-definer helpers prevent recursive profile RLS checks.
create or replace function public.current_user_role()
returns text language sql stable security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.current_user_branch()
returns uuid language sql stable security definer
set search_path = public
as $$
  select branch_id from public.profiles where id = auth.uid()
$$;

create or replace function public.is_central_admin()
returns boolean language sql stable security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() = 'central_admin', false)
$$;

alter table public.branches enable row level security;
alter table public.profiles enable row level security;
alter table public.inventory_items enable row level security;
alter table public.inventory_transactions enable row level security;

drop policy if exists "branches visible to signed in users" on public.branches;
create policy "branches visible to signed in users" on public.branches
for select to authenticated using (true);

drop policy if exists "central admins manage branches" on public.branches;
create policy "central admins manage branches" on public.branches
for all to authenticated using (public.is_central_admin())
with check (public.is_central_admin());

drop policy if exists "users read own profile" on public.profiles;
create policy "users read own profile" on public.profiles
for select to authenticated using (id = auth.uid() or public.is_central_admin());

drop policy if exists "central admins manage profiles" on public.profiles;
create policy "central admins manage profiles" on public.profiles
for all to authenticated using (public.is_central_admin())
with check (public.is_central_admin());

drop policy if exists "users read allowed inventory" on public.inventory_items;
create policy "users read allowed inventory" on public.inventory_items
for select to authenticated using (
  public.is_central_admin() or branch_id = public.current_user_branch()
);

drop policy if exists "branch admins insert inventory" on public.inventory_items;
create policy "branch admins insert inventory" on public.inventory_items
for insert to authenticated with check (
  (public.is_central_admin() or (
    public.current_user_role() = 'branch_admin'
    and branch_id = public.current_user_branch()
  ))
  and (created_by is null or created_by = auth.uid())
);

drop policy if exists "branch admins update inventory" on public.inventory_items;
create policy "branch admins update inventory" on public.inventory_items
for update to authenticated using (
  public.is_central_admin() or (
    public.current_user_role() = 'branch_admin'
    and branch_id = public.current_user_branch()
  )
) with check (
  public.is_central_admin() or (
    public.current_user_role() = 'branch_admin'
    and branch_id = public.current_user_branch()
  )
);

drop policy if exists "central admins delete inventory" on public.inventory_items;
create policy "central admins delete inventory" on public.inventory_items
for delete to authenticated using (public.is_central_admin());

drop policy if exists "users read allowed transactions" on public.inventory_transactions;
create policy "users read allowed transactions" on public.inventory_transactions
for select to authenticated using (
  public.is_central_admin() or branch_id = public.current_user_branch()
);

drop policy if exists "branch admins insert transactions" on public.inventory_transactions;
create policy "branch admins insert transactions" on public.inventory_transactions
for insert to authenticated with check (
  (public.is_central_admin() or (
    public.current_user_role() = 'branch_admin'
    and branch_id = public.current_user_branch()
  ))
  and (performed_by is null or performed_by = auth.uid())
);

-- Authenticated users may read their own profile. Create users in Supabase Auth,
-- then create/update their profile row as a central administrator.
-- Example after creating the auth user:
-- insert into public.profiles (id, full_name, role, branch_id)
-- values ('AUTH-USER-UUID', 'Branch Manager Name', 'branch_admin',
--         (select id from public.branches where name = 'El Shorouk'));
--
-- To create the first central admin, run this once using the UUID from
-- Authentication > Users:
-- insert into public.profiles (id, full_name, role, branch_id)
-- values ('AUTH-USER-UUID', 'NIS SportTrack Admin', 'central_admin', null);
--
-- IMPORTANT: Never expose a Supabase service_role key in frontend code.