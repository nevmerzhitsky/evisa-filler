export function isPersonalFormUrl(value) {
  try {
    const url=value instanceof URL?value:new URL(value);
    return url.origin==='https://evisa.gov.vn' && /^\/e-visa\/foreigners(?:\/[A-Za-z0-9_-]+)?\/?$/.test(url.pathname);
  } catch {return false;}
}
