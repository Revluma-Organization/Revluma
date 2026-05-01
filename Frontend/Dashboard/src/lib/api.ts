import axios from 'axios';

const API_BASE = window.APP_API_BASE?.replace(/\/$/, '') || (() => {
  if (window.location.protocol === 'file:' || !window.location.origin) {
    return 'http://localhost:5000/api';
  }
  return `${window.location.origin}/api`;
})();

const api = axios.create({
  baseURL: API_BASE,
  // Important: send cookies with requests
  withCredentials: true,
});

export default api;