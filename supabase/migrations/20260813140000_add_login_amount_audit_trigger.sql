-- Adds an audit trail for changes to leads.login_amount once it has already been
-- set to a non-null value. login_amount feeds agent target/achievement math and
-- the org-wide Team Targets dashboard, so an unexpected change to it after the
-- fact should be visible rather than silent.
--
-- APPROACH CHOSEN: audit-log, not a hard block.
--
-- A hard BEFORE UPDATE trigger that rejects any change to a non-null
-- login_amount was considered and rejected: the app already has a legitimate,
-- actively-used manual-correction path for login_amount (the "Login Amount
-- Modal" in src/pages/Dashboard.js, backed by a plain
-- `supabase.from('leads').update({login_amount:amt})` call, not an RPC). A hard
-- block would break that existing feature outright unless it were rerouted
-- through a new RPC/service-role escape hatch — extra application surface this
-- migration doesn't touch.
--
-- It's also unnecessary: the two existing triggers that set login_amount
-- automatically (capture_login_amount_on_insert, track_stage_change) both
-- already guard with `login_amount IS NULL`, so neither ever overwrites an
-- existing value. The only way an already-set login_amount can change today is
-- an explicit application-level UPDATE (the correction modal, or any future
-- ad-hoc edit) — which is exactly the case this migration makes visible.

create table if not exists public.login_amount_audit (
  id bigint generated always as identity primary key,
  lead_id uuid not null references public.leads(id) on delete cascade,
  old_value numeric,
  new_value numeric,
  changed_at timestamptz not null default now(),
  changed_by uuid references public.profiles(id)
);

create index if not exists login_amount_audit_lead_id_idx on public.login_amount_audit(lead_id);

-- SECURITY DEFINER so the audit write always succeeds regardless of the calling
-- role's own grants on login_amount_audit. Callers only get SELECT on the table
-- (to review the log) — not INSERT/UPDATE/DELETE — so only this trigger can add
-- rows, and existing audit rows can't be edited or deleted out from under it.
create or replace function public.log_login_amount_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if OLD.login_amount is not null and NEW.login_amount is distinct from OLD.login_amount then
    insert into public.login_amount_audit(lead_id, old_value, new_value, changed_by)
    values (NEW.id, OLD.login_amount, NEW.login_amount, auth.uid());
  end if;
  return null;
end;
$function$;

drop trigger if exists trg_login_amount_audit on public.leads;
create trigger trg_login_amount_audit
  after update on public.leads
  for each row
  execute function public.log_login_amount_change();

grant select on public.login_amount_audit to authenticated, anon;
