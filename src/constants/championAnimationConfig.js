// Gender lookup for the "New Champion" celebration characters (ChampionChangeAnimation).
// profiles.gender (added by supabase/migrations/20261001120000_add_profiles_gender_and_champion_change_rpc.sql)
// and get_champion_change()'s current_gender/previous_gender are the source of truth.
// AGENT_GENDER_MAP is only a fallback for agents whose profiles.gender is still null —
// fill it in by agentId as you learn them, or just run the UPDATE in Supabase instead.
export const AGENT_GENDER_MAP = {
  // 'agent-uuid-here': 'male',
}

export const getChampionGender = (agentId, dbGender, fallback = 'male') => {
  if (dbGender === 'male' || dbGender === 'female') return dbGender
  if (agentId && AGENT_GENDER_MAP[agentId]) return AGENT_GENDER_MAP[agentId]
  return fallback
}
