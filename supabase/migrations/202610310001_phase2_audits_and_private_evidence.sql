-- NIS SportTrack Phase 2 / Step 1: periodic audits and private evidence uploads.
-- Additive only: existing tables, rows, roles and policies are preserved.
create table if not exists public.inventory_audits (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete restrict,
  title text not null,
  audit_date date not null default current_date,
  status text not null default 'draft' check (status in ('draft','in_progress','submitted','under_review','approved','rejected','closed')),
  notes text,
  created_by uuid not null references auth.users(id) on delete restrict,
  submitted_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.inventory_audit_items (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.inventory_audits(id) on delete cascade,
  inventory_id uuid not null references public.inventory(id) on delete restrict,
  equipment_id uuid not null references public.equipment(id) on delete restrict,
  expected_quantity integer not null check (expected_quantity >= 0),
  counted_quantity integer check (counted_quantity is null or counted_quantity >= 0),
  damaged_count integer not null default 0 check (damaged_count >= 0),
  missing_count integer not null default 0 check (missing_count >= 0),
  notes text,
  photo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (audit_id, inventory_id)
);
create index if not exists idx_inventory_audits_branch_date on public.inventory_audits(branch_id, audit_date desc);
create index if not exists idx_inventory_audits_status on public.inventory_audits(status);
create index if not exists idx_inventory_audit_items_audit on public.inventory_audit_items(audit_id);
alter table public.inventory_audits enable row level security;
alter table public.inventory_audit_items enable row level security;
drop policy if exists "Audit access by branch" on public.inventory_audits;
create policy "Audit access by branch" on public.inventory_audits for all to authenticated
using (public.is_super_admin() or (public.current_app_role() = 'branch_manager' and branch_id = public.current_branch_id()))
with check (public.is_super_admin() or (public.current_app_role() = 'branch_manager' and branch_id = public.current_branch_id()));
drop policy if exists "Audit item access by parent branch" on public.inventory_audit_items;
create policy "Audit item access by parent branch" on public.inventory_audit_items for all to authenticated
using (exists (select 1 from public.inventory_audits a where a.id = audit_id and (public.is_super_admin() or (public.current_app_role() = 'branch_manager' and a.branch_id = public.current_branch_id()))))
with check (exists (select 1 from public.inventory_audits a where a.id = audit_id and (public.is_super_admin() or (public.current_app_role() = 'branch_manager' and a.branch_id = public.current_branch_id()))));
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('nis-sporttrack-evidence','nis-sporttrack-evidence',false,10485760,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false,file_size_limit=10485760,allowed_mime_types=array['image/jpeg','image/png','image/webp'];
drop policy if exists "NIS evidence read by permitted branch" on storage.objects;
create policy "NIS evidence read by permitted branch" on storage.objects for select to authenticated
using (
 bucket_id='nis-sporttrack-evidence'
 and (
   public.is_super_admin()
   or (public.current_app_role()='branch_manager' and (
     (storage.foldername(name))[1]='equipment'
     or (storage.foldername(name))[1]=public.current_branch_id()::text
   ))
 )
);
drop policy if exists "NIS evidence upload by permitted branch" on storage.objects;
create policy "NIS evidence upload by permitted branch" on storage.objects for insert to authenticated
with check (
 bucket_id='nis-sporttrack-evidence'
 and (
   public.is_super_admin()
   or (public.current_app_role()='branch_manager' and (storage.foldername(name))[1]=public.current_branch_id()::text)
 )
);
drop policy if exists "NIS evidence delete by permitted branch" on storage.objects;
create policy "NIS evidence delete by permitted branch" on storage.objects for delete to authenticated
using (bucket_id='nis-sporttrack-evidence' and (public.is_super_admin() or (public.current_app_role()='branch_manager' and (storage.foldername(name))[1]=public.current_branch_id()::text)));
