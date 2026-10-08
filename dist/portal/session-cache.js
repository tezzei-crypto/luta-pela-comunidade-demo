// The server remains authoritative. This cache only survives a reload in this tab.
const KEY = 'lpc:portal-session:v1';
const MAX_MS = 6 * 60 * 60 * 1000;
export function createSessionCache(storage = () => sessionStorage, now = () => Date.now()) {
  const clear = () => { try { storage().removeItem(KEY); } catch {} };
  function read() {
    try {
      const value = JSON.parse(storage().getItem(KEY) || 'null');
      if (!value) return null;
      if (typeof value.access_token !== 'string' || !/^[A-Za-z0-9_-]{40,100}$/.test(value.access_token) || !Number.isFinite(value.expires_at) || value.expires_at <= now() || value.expires_at > now() + MAX_MS) {
        clear(); return null;
      }
      return value;
    } catch { clear(); return null; }
  }
  function save(value) {
    const seconds = Number(value.expires_in);
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_MS / 1000) { clear(); return null; }
    const cached = {access_token: value.access_token, expires_at: now() + seconds * 1000};
    try { storage().setItem(KEY, JSON.stringify(cached)); } catch {}
    return cached;
  }
  return {read, save, clear};
}
