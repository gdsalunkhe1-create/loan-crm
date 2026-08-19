-- Fixes: "Delete Selected" in Admin Panel shows a success toast but rows aren't
-- actually deleted. RLS is enabled on leads/calls/tasks but none had a DELETE
-- policy, so Postgres silently denies all deletes (0 rows affected, no error) —
-- the JS client's .delete() call never surfaces this, so the app's try/catch
-- never fires. Adds DELETE policies matching the existing org_isolation_delete
-- pattern already used on loan_obligations/activity_log, and the role-check
-- shape already used by each table's own SELECT/UPDATE policies.

CREATE POLICY "admin_delete_leads" ON public.leads
  FOR DELETE
  USING (
    org_id = current_org_id()
    AND current_user_role() = ANY (ARRAY['admin','manager','team_leader'])
  );

CREATE POLICY "org_isolation_delete_calls" ON public.calls
  FOR DELETE
  USING (
    org_id = current_org_id()
    AND (
      current_user_role() = ANY (ARRAY['admin','manager','team_leader'])
      OR agent_id = auth.uid()
    )
  );

CREATE POLICY "org_isolation_delete_tasks" ON public.tasks
  FOR DELETE
  USING (
    org_id = current_org_id()
    AND (
      current_user_role() = ANY (ARRAY['admin','manager','team_leader'])
      OR assigned_to = auth.uid()
    )
  );
