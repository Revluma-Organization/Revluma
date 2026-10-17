(function () {
  const configuredBase = (
    window.REVLUMA_API_BASE ||
    window.__REVLUMA_CONFIG__?.apiBase ||
    document.querySelector('meta[name="revluma-api-base"]')?.content ||
    (['localhost', '127.0.0.1'].includes(window.location.hostname)
      ? 'http://localhost:8000/api/v1'
      : 'https://revluma-backend-vrsd.onrender.com/api/v1')
  ).replace(/\/+$/, '');

  window.REVLUMA_API_BASE = configuredBase.endsWith('/api/v1')
    ? configuredBase
    : `${configuredBase}/api/v1`;
})();

window.REVLUMA_GOOGLE_CLIENT_ID = '137716714187-75iq86blnhp09hcg7spvhspgath32eol.apps.googleusercontent.com';

// Waitlist API Functions
async function submitWaitlistForm(formData) {
  try {
    const response = await fetch(`${window.REVLUMA_API_BASE}/waitlist/join`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(formData)
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || (result.errors ? result.errors.join(', ') : null) || 'API Error');
    }

    return result;
  } catch (error) {
    console.error('Waitlist API Error:', error);
    throw error;
  }
}

async function updateWaitlistDetails(id, formData) {
  try {
    const response = await fetch(`${window.REVLUMA_API_BASE}/waitlist/${id}/details`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(formData)
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || (result.errors ? result.errors.join(', ') : null) || 'API Error');
    }

    return result;
  } catch (error) {
    console.error('Waitlist API Error:', error);
    throw error;
  }
}

async function getWaitlistStats() {
  try {
    const response = await fetch(`${window.REVLUMA_API_BASE}/waitlist/stats`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      }
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || (result.errors ? result.errors.join(', ') : null) || 'API Error');
    }

    return result;
  } catch (error) {
    console.error('Waitlist API Error:', error);
    throw error;
  }
}