const WAITLIST_URL = 'https://revluma-backend-vrsd.onrender.com/api/v1/waitlist/join';

module.exports = async function joinWaitlist(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed.' });
  }

  const input = typeof req.body === 'string' ? (() => {
    try { return JSON.parse(req.body); } catch { return null; }
  })() : req.body;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return res.status(400).json({ success: false, error: 'Please check the form and try again.' });
  }

  // Forward only the three fields the low-friction public form collects.
  const payload = {
    full_name: typeof input.full_name === 'string' ? input.full_name.trim().slice(0, 120) : '',
    work_email: typeof input.work_email === 'string' ? input.work_email.trim().slice(0, 254) : '',
    company_name: typeof input.company_name === 'string' ? input.company_name.trim().slice(0, 160) : '',
    interested_in_beta: true
  };
  if (!payload.full_name || !payload.company_name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.work_email)) {
    return res.status(400).json({ success: false, error: 'Enter your name, a valid email address and your brand or store name.' });
  }

  // Preserve the platform-provided client address for the backend's existing
  // IP-based waitlist limiter. Forward only its first hop; the backend trusts
  // exactly one proxy, so forwarding the entire chain would identify Vercel.
  const forwarded = req.headers?.['x-forwarded-for'];
  const clientAddress = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : '';
  const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
  if (clientAddress && clientAddress.length <= 64) headers['X-Forwarded-For'] = clientAddress;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const upstream = await fetch(WAITLIST_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const text = await upstream.text();
    let result;
    try { result = JSON.parse(text); } catch { result = { success: false, error: 'The waitlist service returned an unexpected response.' }; }
    return res.status(upstream.status).json(result);
  } catch {
    return res.status(502).json({ success: false, error: 'The waitlist service is temporarily unavailable. Please try again shortly.' });
  } finally {
    clearTimeout(timeout);
  }
};

module.exports.config = { api: { bodyParser: { sizeLimit: '32kb' } } };
