const api = {
  get: async () => ({ data: { success: true, data: {} } }),
  post: async () => ({ data: { success: true } }),
  put: async () => ({ data: { success: true } }),
  delete: async () => ({ data: { success: true } }),
};

export { api as default, api };
