-- Enforce audit submission/review transitions in the database.
create or replace function public.enforce_inventory_audit_workflow()
returns trigger language plpgsql security definer set search_path=public as $$
declare incomplete_count integer;
begin
  if tg_op='UPDATE' then
    if public.current_app_role()='branch_manager' then
      if new.branch_id<>old.branch_id or new.created_by<>old.created_by then raise exception 'Branch managers cannot change audit ownership.'; end if;
      if old.status not in ('draft','in_progress','rejected') or new.status not in ('draft','in_progress','rejected','submitted') then raise exception 'This audit status can only be changed by central administration.'; end if;
      if new.status='submitted' then
        select count(*) into incomplete_count from public.inventory_audit_items where audit_id=old.id and counted_quantity is null;
        if incomplete_count>0 then raise exception 'Complete every item count before submitting the audit.'; end if;
      end if;
    elsif public.is_super_admin() then
      if new.status in ('approved','rejected') and old.status<>'submitted' then raise exception 'Only submitted audits can be reviewed.'; end if;
      if new.status='closed' and old.status<>'approved' then raise exception 'Only approved audits can be closed.'; end if;
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists trg_enforce_inventory_audit_workflow on public.inventory_audits;
create trigger trg_enforce_inventory_audit_workflow before update on public.inventory_audits for each row execute function public.enforce_inventory_audit_workflow();
do $$ begin
  if not exists(select 1 from pg_constraint where conname='audit_item_damage_missing_within_count') then
    alter table public.inventory_audit_items add constraint audit_item_damage_missing_within_count check(counted_quantity is null or damaged_count+missing_count<=counted_quantity);
  end if;
end $$;