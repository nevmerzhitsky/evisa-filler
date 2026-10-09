import { GROUPS, RECORDS, LIST_CONTROLS, SCHEMA_VERSION } from './contract.js';

export function isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= [31,leap ? 29 : 28,31,30,31,30,31,31,30,31,30,31][month-1];
}
const empty = value => value === null || (typeof value === 'string' && value.trim() === '');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function validateApplication(text) {
  const errors = [], skipped = [];
  const error = (path, reason) => errors.push({path, reason});
  const skip = path => skipped.push({path, status:'skipped_empty', reason:'No value supplied'});
  let raw;
  try { if (typeof text !== 'string') throw new Error(); raw = JSON.parse(text); }
  catch { return {ok:false, data:null, errors:[{path:'$', reason:'Expected valid JSON text'}], skipped}; }
  if (!object(raw)) return {ok:false,data:null,errors:[{path:'$',reason:'Expected an object'}],skipped};
  if (raw.schemaVersion !== SCHEMA_VERSION) error('schemaVersion','Expected schema version 1');
  function walk(input, definitions, prefix, required = []) {
    if (!object(input)) { error(prefix || '$','Expected an object'); return {}; }
    const out = {};
    for (const key of Object.keys(input)) if (!Object.hasOwn(definitions,key)) error(prefix ? `${prefix}.${key}` : key,'Unknown key');
    for (const [key,type] of Object.entries(definitions)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (!Object.hasOwn(input,key) || empty(input[key]) || ((type === 'choices' || type === 'records') && Array.isArray(input[key]) && input[key].length === 0)) {
        if (required.includes(key)) error(path,'Required nonempty value');
        else skip(path);
        continue;
      }
      let value = input[key];
      if (type === 'version') { out[key]=value; continue; }
      if (typeof type === 'object') { const child = walk(value,type,path); if (Object.keys(child).length) out[key]=child; continue; }
      if (type === 'choices' || type === 'records') {
        if (!Array.isArray(value)) { error(path,'Expected an array'); continue; }
        out[key] = value.map((item,index) => {
          const itemPath = `${path}[${index}]`;
          if (type === 'choices') {
            if (typeof item !== 'string' || !item.trim()) { error(itemPath,'Expected a nonempty choice string'); return null; }
            return item.trim();
          }
          const definition = RECORDS[key];
          return walk(item, definition, itemPath, Object.keys(definition).filter(name => name !== 'typeDetails'));
        });
        continue;
      }
      if (typeof value === 'string') value = value.trim();
      const valid = (type === 'text' || type === 'choice') ? typeof value === 'string'
        : type === 'date' ? typeof value === 'string' && isCalendarDate(value)
        : type === 'bool' ? typeof value === 'boolean'
        : type === 'number' ? typeof value === 'number' && Number.isFinite(value) && value >= 0
        : type === 'year' ? Number.isInteger(value) && value >= 1000 && value <= 9999
        : Number.isInteger(value) && value > 0;
      if (!valid) error(path,`Invalid ${type} value`); else out[key]=value;
    }
    return out;
  }
  const data = walk(raw,{schemaVersion:'version',...GROUPS},'');
  data.schemaVersion = SCHEMA_VERSION;
  const get = path => path.split('.').reduce((value,key) => value?.[key],data);
  for (const [list,control] of Object.entries(LIST_CONTROLS)) if (get(list)?.length) {
    if (get(control) === false) error(control,'False conflicts with a nonempty dependent list');
    else {
      const [group,key] = control.split('.'); data[group][key]=true;
      const skippedIndex = skipped.findIndex(item => item.path === control);
      if (skippedIndex >= 0) skipped.splice(skippedIndex,1);
    }
  }
  const personal = data.personal;
  if (personal?.dateOfBirth !== undefined && personal.yearOfBirth !== undefined) error('personal.yearOfBirth','Conflicts with dateOfBirth');
  function interval(record, from, to, prefix) {
    if (record?.[from] !== undefined && record[to] !== undefined && record[from] > record[to]) error(`${prefix}.${to}`,'End date precedes start date');
  }
  interval(data.passport,'dateOfIssue','dateOfExpiry','passport');
  interval(data.visa,'validFrom','validTo','visa');
  data.passport?.otherValidPassports?.forEach((record,index) => interval(record,'dateOfIssue','dateOfExpiry',`passport.otherValidPassports[${index}]`));
  data.trip?.previousVisits?.forEach((record,index) => interval(record,'from','to',`trip.previousVisits[${index}]`));
  if (data.expenses?.hasInsurance === false && data.expenses.insuranceDetails !== undefined) error('expenses.insuranceDetails','Conflicts with hasInsurance false');
  return {ok:errors.length === 0,data:errors.length ? null : data,errors,skipped};
}
export const validate = validateApplication;
