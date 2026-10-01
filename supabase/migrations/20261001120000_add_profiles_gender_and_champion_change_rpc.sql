-- Adds profiles.gender (nullable 'male'/'female') and a get_champion_change() RPC
-- that returns the current- and previous-month champion (rank-1 of the existing
-- get_monthly_leaderboard, for two separate month ranges) together with each
-- champion's gender — for the "New Champion" celebration animation
-- (src/components/ChampionChangeAnimation.jsx). Reuses get_monthly_leaderboard's
-- own aggregation rather than re-implementing it, so the two can't drift.
--
-- AGENT_GENDER_MAP in src/constants/championAnimationConfig.js is only a fallback
-- for agents whose profiles.gender is still null.

alter table public.profiles
  add column if not exists gender text;

alter table public.profiles
  drop constraint if exists profiles_gender_check;

alter table public.profiles
  add constraint profiles_gender_check check (gender is null or gender in ('male','female'));

create or replace function public.get_champion_change(
  month_start timestamp with time zone,
  month_end timestamp with time zone,
  prev_month_start timestamp with time zone,
  prev_month_end timestamp with time zone
)
returns table (
  current_agent_id uuid,
  current_name text,
  current_amount numeric,
  current_gender text,
  previous_agent_id uuid,
  previous_name text,
  previous_amount numeric,
  previous_gender text
)
language sql
security definer
set search_path to 'public'
as $function$
  with current_champ as (
    select *
    from public.get_monthly_leaderboard(month_start, month_end)
    order by total_amount desc
    limit 1
  ),
  previous_champ as (
    select *
    from public.get_monthly_leaderboard(prev_month_start, prev_month_end)
    order by total_amount desc
    limit 1
  )
  select
    c.agent_id,
    c.agent_name,
    c.total_amount,
    cp.gender,
    pr.agent_id,
    pr.agent_name,
    pr.total_amount,
    pp.gender
  from current_champ c
  full join previous_champ pr on true
  left join public.profiles cp on cp.id = c.agent_id
  left join public.profiles pp on pp.id = pr.agent_id;
$function$;
