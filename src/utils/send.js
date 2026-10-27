// api/whatsapp/send.js
// Sends a WhatsApp message to a lead on behalf of the logged-in CRM user.
//
// Request (POST, JSON), header: Authorization: Bearer <user's Supabase access token>
//   Free text:  { "lead_id": "...", "text": "Hello" }
//   Template:   { "lead_id": "...", "template": { "name": "welcome", "language": "en",
//                                                  "components": [ ... optional ... ] } }
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WHATSAPP_GRAPH_VERSION (e.g. v21.0 - check Meta's current version)

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const GRAPH = process.env.WHATSAPP_GRAPH_VERSION || 'v21.0';
const last10 = (n) => String(n || '').replace(/\D/g, '').slice(-10);

// TODO: tokens are stored in access_token_encrypted. Until Supabase Vault/pgsodium is set up,
// this returns the stored value as-is. Replace with real decryption before production.
function getToken(account) {
  return account.access_token_encrypted;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  // 1) Who is calling?
  const jwt = (req.headers.authorization || '').replace('Bearer ', '');
  const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !userData?.user) return res.status(401).json({ error: 'Not signed in' });

  const { data: profile } = await supabase
    .from('profiles')
    .select('org_id, role')
    .eq('id', userData.user.id)
    .single();
  if (!profile?.org_id) return res.status(403).json({ error: 'No organization' });

  // 2) Load the lead and check access (same rule as the RLS policy)
  const { lead_id, text, template } = req.body || {};
  if (!lead_id || (!text && !template)) {
    return res.status(400).json({ error: 'lead_id and text or template required' });
  }

  const { data: lead } = await supabase
    .from('leads')
    .select('id, org_id, mobile, assigned_to, team_leader_id')
    .eq('id', lead_id)
    .single();

  if (!lead || lead.org_id !== profile.org_id) return res.status(404).json({ error: 'Lead not found' });

  const uid = userData.user.id;
  const allowed =
    ['admin', 'manager'].includes(profile.role) ||
    lead.assigned_to === uid ||
    lead.team_leader_id === uid;
  if (!allowed) return res.status(403).json({ error: 'Not allowed for this lead' });

  // 3) Which WhatsApp number to send from
  const { data: account } = await supabase
    .from('whatsapp_accounts')
    .select('phone_number_id, access_token_encrypted')
    .eq('org_id', profile.org_id)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!account) return res.status(409).json({ error: 'No WhatsApp number connected', code: 'no_account' });

  // 4) Recipient and 24-hour window
  const { data: lastIn } = await supabase
    .from('whatsapp_messages')
    .select('contact_wa_id, created_at')
    .eq('lead_id', lead.id)
    .eq('direction', 'in')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Prefer the number WhatsApp gave us; otherwise assume India (+91) from the lead's mobile
  const to = lastIn?.contact_wa_id || `91${last10(lead.mobile)}`;
  const windowOpen =
    lastIn && Date.now() - new Date(lastIn.created_at).getTime() < 24 * 60 * 60 * 1000;

  if (text && !windowOpen) {
    return res.status(409).json({
      error: 'More than 24 hours since the customer last wrote. Send an approved template instead.',
      code: 'window_closed',
    });
  }

  // 5) Send via Meta's Cloud API
  const body = text
    ? { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }
    : {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: template.name,
          language: { code: template.language || 'en' },
          ...(template.components ? { components: template.components } : {}),
        },
      };

  const resp = await fetch(`https://graph.facebook.com/${GRAPH}/${account.phone_number_id}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getToken(account)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const result = await resp.json();

  if (!resp.ok) {
    console.error('WhatsApp send failed', result);
    return res.status(502).json({ error: result?.error?.message || 'Send failed', code: 'meta_error' });
  }

  // 6) Save the outbound message so it shows in the inbox immediately
  const waMessageId = result.messages?.[0]?.id;
  await supabase.from('whatsapp_messages').insert({
    org_id: profile.org_id,
    wa_message_id: waMessageId,
    phone_number_id: account.phone_number_id,
    contact_wa_id: to,
    lead_id: lead.id,
    direction: 'out',
    msg_type: text ? 'text' : 'template',
    body: text || `[template] ${template.name}`,
    status: 'sent',
  });

  return res.status(200).json({ ok: true, message_id: waMessageId });
}
