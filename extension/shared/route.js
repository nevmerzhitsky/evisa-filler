export function personalFormMode(value) {
  try {
    const url=value instanceof URL?value:new URL(value);
    if(url.origin!=='https://evisa.gov.vn')return null;
    if(/^\/e-visa\/foreigners\/?$/.test(url.pathname))return 'new';
    if(/^\/e-visa\/foreigners\/[A-Za-z0-9_-]+\/?$/.test(url.pathname))return 'saved';
    return null;
  } catch {return null;}
}

export const isPersonalFormUrl=value=>personalFormMode(value)!==null;
