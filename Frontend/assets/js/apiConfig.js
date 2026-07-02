// API Configuration
const API_BASE_URL = window.location.hostname === 'localhost' 
  ? 'http://localhost:8080/api/v1'
  : 'https://your-production-backend-url/api/v1';

async function callAPI(endpoint, method = 'GET', data = null) {
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
  };

  if (data) {
    options.body = JSON.stringify(data);
  }

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, options);
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || result.errors?.join(', ') || 'API Error');
    }

    return result;
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
}

// Waitlist API Functions
async function submitWaitlistForm(formData) {
  return callAPI('/waitlist/join', 'POST', formData);
}

async function getWaitlistStats() {
  return callAPI('/waitlist/stats', 'GET');
}