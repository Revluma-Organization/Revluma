// API Configuration
(function() {
  const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  // TODO: replace with your actual Render backend URL
  window.REVLUMA_API_BASE = isLocal
    ? 'http://localhost:8000/api/v1'
    : 'https://revluma-backend.onrender.com/api/v1';
})();

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