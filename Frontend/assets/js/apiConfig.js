// API Configuration
(function() {
  window.REVLUMA_API_BASE = 'http://localhost:8000/api/v1';
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