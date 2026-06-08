const PREFIX = 'revluma_';

export const storage = {
  get<T>(key: string, defaultValue: T): T {
    try {
      const item = localStorage.getItem(PREFIX + key);
      return item ? JSON.parse(item) : defaultValue;
    } catch {
      return defaultValue;
    }
  },

  set<T>(key: string, value: T): void {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      /* quota exceeded — silently ignore */
    }
  },

  remove(key: string): void {
    try {
      localStorage.removeItem(PREFIX + key);
    } catch {
      /* ignore */
    }
  },

  session: {
    get<T>(key: string, defaultValue: T): T {
      try {
        const item = sessionStorage.getItem(PREFIX + key);
        return item ? JSON.parse(item) : defaultValue;
      } catch {
        return defaultValue;
      }
    },
    set<T>(key: string, value: T): void {
      try {
        sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
      } catch {
        /* ignore */
      }
    },
    remove(key: string): void {
      try {
        sessionStorage.removeItem(PREFIX + key);
      } catch {
        /* ignore */
      }
    },
  },
};
