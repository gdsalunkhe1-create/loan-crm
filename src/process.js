// api/whatsapp/process.js
// Safety-net endpoint: processes any queued events. Call it on a schedule.
// Protect it with CRON_SECRET (set in Vercel env vars).
import { processPending } from '../../lib/whatsappProcessor.js';

export default async function handler(req, res) {
  const auth = req.headers.authorization || '';
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).send('Unauthorized');
  }
  const result = await processPending(100);
  return res.status(200).json(result);
}
