// api/whatsapp/webhook.js  (Vercel Node serverless function)
// Env vars needed in Vercel:
//   WHATSAPP_VERIFY_TOKEN   - any random string you also enter in Meta's webhook settings
//   META_APP_SECRET         - your Meta app secret (used to verify signatures)
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { waitUntil } from '@vercel/functions';
import { processPending } from '../../lib/whatsappProcessor.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Read the raw body BEFORE touching req.body, because the signature
// must be computed over the exact bytes Meta sent.
async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function validSignature(rawBody, header) {
  if (!header || !header.startsWith('sha256=')) return false;
  const expected =
    'sha256=' +
    crypto.createHmac('sha256', process.env.META_APP_SECRET).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Turn one webhook payload into queue rows (one per message / status update).
function extractEvents(payload) {
  const rows = [];
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const phoneNumberId = value.metadata?.phone_number_id || null;

      for (const msg of value.messages || []) {
        rows.push({
          event_key: `msg:${msg.id}`,
          phone_number_id: phoneNumberId,
          payload: { kind: 'message', value, message: msg },
        });
      }
      for (const st of value.statuses || []) {
        rows.push({
          event_key: `status:${st.id}:${st.status}`,
          phone_number_id: phoneNumberId,
          payload: { kind: 'status', value, status: st },
        });
      }
    }
  }
  return rows;
}

export default async function handler(req, res) {
  // 1) Meta's one-time verification handshake
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  // 2) Verify signature
  const rawBody = await readRawBody(req);
  if (!validSignature(rawBody, req.headers['x-hub-signature-256'])) {
    return res.status(401).send('Invalid signature');
  }

  // 3) Queue events and return 200 fast. Chatbot logic runs in a separate worker.
  try {
    const payload = JSON.parse(rawBody.toString('utf8'));
    const rows = extractEvents(payload);
    if (rows.length) {
      // ignoreDuplicates makes Meta retries harmless
      const { error } = await supabase
        .from('whatsapp_events')
        .upsert(rows, { onConflict: 'event_key', ignoreDuplicates: true });
      if (error) console.error('queue insert failed', error);
      // Process after responding to Meta, without blocking the 200
      else waitUntil(processPending());
    }
  } catch (e) {
    console.error('webhook parse error', e);
  }

  // Always 200 once the signature is valid so Meta does not keep retrying
  return res.status(200).send('OK');
}
