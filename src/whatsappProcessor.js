// lib/whatsappProcessor.js
// Turns rows in whatsapp_events into whatsapp_messages, linked to leads.
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Customer numbers arrive like "919876543210". Leads store 10-digit mobiles in many formats,
// so we match on the last 10 digits.
const last10 = (n) => String(n || '').replace(/\D/g, '').slice(-10);

function extractBody(msg) {
  switch (msg.type) {
    case 'text':
      return msg.text?.body || null;
    case 'button':
      return msg.button?.text || null;
    case 'interactive':
      return (
        msg.interactive?.button_reply?.title ||
        msg.interactive?.list_reply?.title ||
        null
      );
    case 'image':
    case 'video':
    case 'document':
      return msg[msg.type]?.caption || null;
    default:
      return null;
  }
}

async function findOrCreateLead(orgId, waId, profileName) {
  const mobile = last10(waId);
  if (mobile.length < 10) return null;

  const { data: existing } = await supabase
    .from('leads')
    .select('id')
    .eq('org_id', orgId)
    .ilike('mobile', `%${mobile}`)
    .order('created_at', { ascending: false })
    .limit(1);

  if (existing?.length) return existing[0].id;

  // Unknown number -> new lead. Adjust defaults (status, source) to match your pipeline.
  const { data: created, error } = await supabase
    .from('leads')
    .insert({
      org_id: orgId,
      full_name: profileName || `WhatsApp ${mobile}`,
      mobile,
      lead_source: 'WhatsApp',
      source: 'WhatsApp',
    })
    .select('id')
    .single();

  if (error) {
    console.error('lead create failed', error);
    return null;
  }
  return created.id;
}

async function handleMessage(event, account) {
  const { value, message: msg } = event.payload;
  const waId = msg.from;
  const profileName = value.contacts?.find((c) => c.wa_id === waId)?.profile?.name;

  const leadId = await findOrCreateLead(account.org_id, waId, profileName);

  const { error } = await supabase.from('whatsapp_messages').upsert(
    {
      org_id: account.org_id,
      wa_message_id: msg.id,
      phone_number_id: account.phone_number_id,
      contact_wa_id: waId,
      lead_id: leadId,
      direction: 'in',
      msg_type: msg.type,
      body: extractBody(msg),
      status: 'received',
      created_at: msg.timestamp
        ? new Date(Number(msg.timestamp) * 1000).toISOString()
        : undefined,
    },
    { onConflict: 'wa_message_id', ignoreDuplicates: true }
  );
  if (error) throw error;

  // TODO (chatbot): call the bot here, e.g. await runBot({ account, leadId, msg })
  // Media: msg.image?.id / msg.document?.id are Meta media IDs. Download and store them in
  // Supabase Storage soon after receipt, because Meta's media links expire.
}

async function handleStatus(event) {
  const st = event.payload.status;
  const { error } = await supabase
    .from('whatsapp_messages')
    .update({ status: st.status }) // sent / delivered / read / failed
    .eq('wa_message_id', st.id);
  if (error) throw error;
}

export async function processPending(limit = 50) {
  const { data: events, error } = await supabase
    .from('whatsapp_events')
    .select('*')
    .eq('processed', false)
    .order('received_at', { ascending: true })
    .limit(limit);

  if (error) {
    console.error('fetch events failed', error);
    return { processed: 0, failed: 0 };
  }

  let processed = 0;
  let failed = 0;

  for (const event of events || []) {
    try {
      const { data: account } = await supabase
        .from('whatsapp_accounts')
        .select('org_id, phone_number_id')
        .eq('phone_number_id', event.phone_number_id)
        .maybeSingle();

      if (!account) {
        // Not one of our connected numbers. Mark done so it doesn't loop forever.
        await supabase
          .from('whatsapp_events')
          .update({ processed: true, error: 'unknown phone_number_id' })
          .eq('id', event.id);
        continue;
      }

      if (event.payload.kind === 'message') await handleMessage(event, account);
      else if (event.payload.kind === 'status') await handleStatus(event);

      await supabase.from('whatsapp_events').update({ processed: true }).eq('id', event.id);
      processed++;
    } catch (e) {
      failed++;
      console.error('event failed', event.id, e);
      await supabase
        .from('whatsapp_events')
        .update({ error: String(e.message || e).slice(0, 500) })
        .eq('id', event.id);
    }
  }
  return { processed, failed };
}
