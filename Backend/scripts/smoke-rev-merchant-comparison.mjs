/** Authenticated production smoke test. No token or merchant data is printed. */
const base = process.env.REV_API_BASE_URL || 'https://revluma-backend-vrsd.onrender.com';
const token = process.env.REV_MERCHANT_ACCESS_TOKEN;
if (!token) {
  console.error('Set REV_MERCHANT_ACCESS_TOKEN to a valid merchant access token.');
  process.exit(2);
}
const endpoint = new URL('/api/v1/rev/chat', base);
const response = await fetch(endpoint, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: 'What has changed in my store recently? Compare my current performance with previous records.' }),
  signal: AbortSignal.timeout(45000),
});
const body = await response.json();
if (!response.ok || body.success === false) {
  console.error('Merchant comparison request failed:', response.status, body.error?.code || 'unknown');
  process.exit(1);
}
const answer = body.text || body.data?.text || body.response?.text || body.data?.response?.text || '';
if (!answer.includes('Latest period') || !answer.includes('Previous period 1') || !answer.includes('Evidence limitations')) {
  console.error('Comparison response is missing verified period evidence sections.');
  process.exit(1);
}
if (!body.conversation_id && !body.data?.conversation_id) {
  console.error('Response lacks conversation identifier.');
  process.exit(1);
}
console.log('PASS: authenticated merchant comparison returned period evidence and limitations.');
