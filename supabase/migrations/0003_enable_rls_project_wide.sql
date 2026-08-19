-- 0003_enable_rls_project_wide.sql
-- Re-enables Row Level Security across all currently-exposed tables.
-- NOT applied to the live project — review first, this is a HIGH-RISK
-- change to test carefully (see notes at bottom before running).

-- ============================================================
-- PART A: Tables with complete, correct policies already written
-- (from the July multi-tenant migration) — just flip RLS on.
-- ============================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispositions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loan_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- PART B: Tables with no policies at all — write org-scoped
-- policies matching the same pattern as leads/calls/tasks,
-- THEN enable RLS. Order matters: policy first, RLS second,
-- or every request briefly returns zero rows in between.
-- ============================================================

-- customer_cibil_data: no org_id column — scope via its lead_id -> leads.org_id
CREATE POLICY cibil_org_isolation_select ON public.customer_cibil_data
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.leads
    WHERE leads.id = customer_cibil_data.lead_id
    AND leads.org_id = current_org_id()
  ));

CREATE POLICY cibil_org_isolation_insert ON public.customer_cibil_data
  FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.leads
    WHERE leads.id = customer_cibil_data.lead_id
    AND leads.org_id = current_org_id()
  ));

CREATE POLICY cibil_org_isolation_update ON public.customer_cibil_data
  FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.leads
    WHERE leads.id = customer_cibil_data.lead_id
    AND leads.org_id = current_org_id()
  ));

ALTER TABLE public.customer_cibil_data ENABLE ROW LEVEL SECURITY;

-- customer_bank_statement_data: same pattern, same reasoning
CREATE POLICY bsa_org_isolation_select ON public.customer_bank_statement_data
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.leads
    WHERE leads.id = customer_bank_statement_data.lead_id
    AND leads.org_id = current_org_id()
  ));

CREATE POLICY bsa_org_isolation_insert ON public.customer_bank_statement_data
  FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.leads
    WHERE leads.id = customer_bank_statement_data.lead_id
    AND leads.org_id = current_org_id()
  ));

CREATE POLICY bsa_org_isolation_update ON public.customer_bank_statement_data
  FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.leads
    WHERE leads.id = customer_bank_statement_data.lead_id
    AND leads.org_id = current_org_id()
  ));

ALTER TABLE public.customer_bank_statement_data ENABLE ROW LEVEL SECURITY;

-- agent_monthly_targets: has org_id directly, but targets are self-set by
-- the agent — so agents manage their own row, admin/manager see all in org
CREATE POLICY amt_select ON public.agent_monthly_targets
  FOR SELECT
  USING (
    org_id = current_org_id()
    AND (agent_id = auth.uid() OR current_user_role() = ANY (ARRAY['admin','manager','team_leader']))
  );

CREATE POLICY amt_insert ON public.agent_monthly_targets
  FOR INSERT
  WITH CHECK (org_id = current_org_id() AND agent_id = auth.uid());

CREATE POLICY amt_update ON public.agent_monthly_targets
  FOR UPDATE
  USING (org_id = current_org_id() AND agent_id = auth.uid());

ALTER TABLE public.agent_monthly_targets ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- PART C: activity_logs (plural) — confirmed orphaned/unused
-- dead table (App.js routes only touch activity_log, singular).
-- Enabling RLS with a deny-all default is enough since nothing
-- reads or writes it; not worth policy-authoring effort.
-- ============================================================
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
-- No policies added intentionally: RLS enabled + zero policies = fully
-- locked, which is correct for a table nothing in the app touches.

-- ============================================================
-- BEFORE RUNNING THIS ON PRODUCTION:
-- 1. Test on a Supabase branch first if possible, or a low-traffic window.
-- 2. After applying, manually test as each role: admin, manager,
--    team_leader, agent — specifically: login, leads list, Admin Panel,
--    Log Call modal, CIBIL/BSA upload+view, agent target setting.
-- 3. Watch for "0 results" / blank screens rather than errors — that's
--    RLS's failure mode (see the July Admin Panel "0 leads" incident,
--    the lead_stages dropdown fallback bug — same class of silent bug).
-- 4. Keep this migration's PART A and PART B order intact if re-running:
--    policies must exist before RLS is enabled on customer_cibil_data /
--    customer_bank_statement_data / agent_monthly_targets, or the app
--    briefly reads zero rows from them.
-- ============================================================
