import axios from 'axios';

const isLocalDev = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const API_BASE = isLocalDev
  ? 'http://localhost:5000/api'
  : 'https://revluma.onrender.com/api';

const api = axios.create({
  baseURL: API_BASE,
  // Important: send cookies with requests
  withCredentials: true,
});

export default api;