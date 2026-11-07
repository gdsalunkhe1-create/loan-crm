// click-to-call — Exotel "connect two numbers" for CALL-Q PRO.
//
// Flow: Exotel rings the logged-in agent's own mobile (profiles.mobile) first;
// when the agent answers, Exotel dials the customer and bridges the two legs.
//
// Request (POST, JSON):  { leadId: string, customerPhone?: string }
//                        The number dialled is always the lead's own mobile from
//                        the database; customerPhone in the body is ignored.
// Access:                the caller must be the lead's assigned agent, be listed
//                        in its mirror_agents, or have role admin / manager / team_leader.
// Auth:                  the caller's Supabase session (Authorization: Bearer <jwt>)
// Secrets (Deno.env):    EXOTEL_SID, EXOTEL_API_KEY, EXOTEL_API_TOKEN, EXOTEL_CALLER_ID
// Optional:              EXOTEL_SUBDOMAIN (default "api.exotel.com"; use
//                        "api.in.exotel.com" if your account is on the Mumbai cluster)

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fail(status: number, error: string, details?: unknown): Response {
  return json({ ok: false, error, ...(details !== undefined ? { details } : {}) }, status);
}

// Normalise an Indian mobile number to Exotel's 0XXXXXXXXXX format.
// Accepts "+91 98765 43210", "919876543210", "09876543210", "98765-43210", etc.
// Returns null if it isn't a valid 10-digit Indian mobile.
function normaliseIndianMobile(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  let digits = String(raw).replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (!/^[6-9]\d{9}$/.test(digits)) return null;
  return "0" + digits;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return fail(405, "Method not allowed. Use POST.");
  }

  // ---- Config ---------------------------------------------------------------
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  const EXOTEL_SID = Deno.env.get("EXOTEL_SID");
  const EXOTEL_API_KEY = Deno.env.get("EXOTEL_API_KEY");
  const EXOTEL_API_TOKEN = Deno.env.get("EXOTEL_API_TOKEN");
  const EXOTEL_CALLER_ID = Deno.env.get("EXOTEL_CALLER_ID");
  const EXOTEL_SUBDOMAIN = Deno.env.get("EXOTEL_SUBDOMAIN") || "api.exotel.com";

  const missing = Object.entries({
    EXOTEL_SID,
    EXOTEL_API_KEY,
    EXOTEL_API_TOKEN,
    EXOTEL_CALLER_ID,
  }).filter(([, v]) => !v).map(([k]) => k);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return fail(500, "Server misconfigured: Supabase environment is missing.");
  }
  if (missing.length) {
    return fail(500, `Server misconfigured: missing secret(s) ${missing.join(", ")}.`);
  }

  // ---- Auth -----------------------------------------------------------------
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return fail(401, "Not logged in.");

  // Client scoped to the caller: every query below runs under their RLS.
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
  const user = userData?.user;
  if (userError || !user) return fail(401, "Session expired or invalid. Please log in again.");

  // ---- Input ----------------------------------------------------------------
  let body: { leadId?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail(400, "Request body must be JSON.");
  }
  const leadId = typeof body?.leadId === "string" && body.leadId.trim() ? body.leadId.trim() : null;
  if (!leadId) return fail(400, "leadId is required.");

  // ---- Caller's profile: own mobile (the leg Exotel rings first) + role --------
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("mobile, role")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) return fail(500, "Couldn't load your profile.", profileError.message);
  if (!profile) return fail(403, "No profile found for your account.");

  // ---- Lead check (always) ----------------------------------------------------
  // RLS already scopes this query to the caller's org; on top of that the caller
  // must be the assigned agent, a mirror agent, or hold a supervisory role. A NULL/unknown role
  // is never privileged.
  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id, mobile, assigned_to, mirror_agents")
    .eq("id", leadId)
    .maybeSingle();
  if (leadError) return fail(500, "Couldn't load the lead.", leadError.message);
  if (!lead) return fail(404, "Lead not found.");

  const SUPERVISOR_ROLES = ["admin", "manager", "team_leader"];
  const isAssigned = lead.assigned_to === user.id;
  const isMirrorAgent = Array.isArray(lead.mirror_agents) && lead.mirror_agents.includes(user.id);
  const isSupervisor = typeof profile.role === "string" && SUPERVISOR_ROLES.includes(profile.role);
  if (!isAssigned && !isMirrorAgent && !isSupervisor) {
    return fail(403, "You can only call leads assigned to you.");
  }

  // Number to dial comes from the database, never from the request body.
  const customerPhone = normaliseIndianMobile(lead.mobile);
  if (!customerPhone) {
    return fail(400, "This lead's mobile number is missing or isn't a valid Indian mobile number.");
  }

  const agentPhone = normaliseIndianMobile(profile.mobile);
  if (!agentPhone) {
    return fail(
      400,
      "Your mobile number isn't set (or isn't valid) in your profile. Ask an admin to add it.",
    );
  }

  // ---- Exotel ---------------------------------------------------------------
  const form = new URLSearchParams({
    From: agentPhone,
    To: customerPhone,
    CallerId: EXOTEL_CALLER_ID!,
    Record: "true",
    CustomField: leadId,
  });

  const exotelUrl =
    `https://${EXOTEL_SUBDOMAIN}/v1/Accounts/${encodeURIComponent(EXOTEL_SID!)}/Calls/connect.json`;

  let exotelRes: Response;
  try {
    exotelRes = await fetch(exotelUrl, {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(`${EXOTEL_API_KEY}:${EXOTEL_API_TOKEN}`),
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: form.toString(),
    });
  } catch (e) {
    return fail(502, "Couldn't reach Exotel. Please try again.", String(e));
  }

  const text = await exotelRes.text();
  let exotel: any;
  try {
    exotel = text ? JSON.parse(text) : null;
  } catch {
    exotel = { raw: text };
  }

  if (!exotelRes.ok) {
    const message = exotel?.RestException?.Message || exotel?.message || `HTTP ${exotelRes.status}`;
    console.error("Exotel error", exotelRes.status, text);
    return fail(502, `Exotel rejected the call: ${message}`, exotel);
  }

  return json({ ok: true, callSid: exotel?.Call?.Sid ?? null, exotel });
});
