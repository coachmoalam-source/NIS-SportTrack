-- NIS SportTrack: tighten periodic audit permissions.

drop policy if exists "Audit access by branch" on public.inventory_audits;
drop policy if exists "Audit headers read by branch" on public.inventory_audits;
create policy "Audit headers read by branch" on public.inventory_audits for select to authenticated
using (public.is_super_admin() or (public.current_app_role()='branch_manager' and branch_id=public.current_branch_id()));
drop policy if exists "Audit headers create by branch" on public.inventory_audits;
create policy "Audit headers create by branch" on public.inventory_audits for insert to authenticated
with check (public.is_super_admin() or (public.current_app_role()='branch_manager' and branch_id=public.current_branch_id() and status in ('draft','in_progress')));
drop policy if exists "Audit headers update by role" on public.inventory_audits;
create policy "Audit headers update by role" on public.inventory_audits for update to authenticated
using (public.is_super_admin() or (public.current_app_role()='branch_manager' and branch_id=public.current_branch_id() and status in ('draft','in_progress','rejected')))
with check (public.is_super_admin() or (public.current_app_role()='branch_manager' and branch_id=public.current_branch_id() and status in ('draft','in_progress','rejected','submitted')));
drop policy if exists "Audit headers delete by central" on public.inventory_audits;
create policy "Audit headers delete by central" on public.inventory_audits for delete to authenticated using (public.is_super_admin());
drop policy if exists "Audit item access by parent branch" on public.inventory_audit_items;
drop policy if exists "Audit items read by parent branch" on public.inventory_audit_items;
create policy "Audit items read by parent branch" on public.inventory_audit_items for select to authenticated
using (exists(select 1 from public.inventory_audits a where a.id=audit_id and (public.is_super_admin() or (public.current_app_role()='branch_manager' and a.branch_id=public.current_branch_id()))));
drop policy if exists "Audit items create by parent branch" on public.inventory_audit_items;
create policy "Audit items create by parent branch" on public.inventory_audit_items for insert to authenticated
with check (exists(select 1 from public.inventory_audits a where a.id=audit_id and (public.is_super_admin() or (public.current_app_role()='branch_manager' and a.branch_id=public.current_branch_id() and a.status in ('draft','in_progress')))));
drop policy if exists "Audit items update by role" on public.inventory_audit_items;
create policy "Audit items update by role" on public.inventory_audit_items for update to authenticated
using (exists(select 1 from public.inventory_audits a where a.id=audit_id and (public.is_super_admin() or (public.current_app_role()='branch_manager' and a.branch_id=public.current_branch_id() and a.status in ('draft','in_progress','rejected')))))
with check (exists(select 1 from public.inventory_audits a where a.id=audit_id and (public.is_super_admin() or (public.current_app_role()='branch_manager' and a.branch_id=public.current_branch_id() and a.status in ('draft','in_progress','rejected')))));
drop policy if exists "Audit items delete by central" on public.inventory_audit_items;
create policy "Audit items delete by central" on public.inventory_audit_items for delete to authenticated using (public.is_super_admin());