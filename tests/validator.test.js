import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateApplication, isCalendarDate} from '../extension/shared/validator.js';
import {GROUPS, RECORDS, LIST_CONTROLS, FIELDS} from '../extension/shared/contract.js';
const check = value => validateApplication(JSON.stringify(value));
const bad = value => { const result=check(value); assert.equal(result.ok,false); assert.equal(result.data,null); return result.errors; };
test('fictional examples normalize successfully',()=>{
  for(const name of ['minimal','extended']) assert.equal(validateApplication(readFileSync(new URL(`../examples/${name}.json`,import.meta.url),'utf8')).ok,true);
});
test('parse failures never expose input values',()=>{
  assert.deepEqual(validateApplication('{SECRET').errors,[{path:'$',reason:'Expected valid JSON text'}]);
  for(const value of [null,[],false,1,'secret']) bad(value);
  for(const value of [{},{schemaVersion:2},{schemaVersion:'1'},{schemaVersion:null}])bad(value);
});
test('unknown keys are errors even when empty at every nesting level',()=>{
  for(const value of [{schemaVersion:1,unknown:null},{schemaVersion:1,personal:{unknown:''}},{schemaVersion:1,contact:{emergency:{unknown:null}}},{schemaVersion:1,trip:{previousVisits:[{from:'2025-01-01',to:'2025-01-02',purpose:'Tourism',unknown:null}]}}])assert.ok(bad(value).some(e=>e.reason==='Unknown key'));
});
test('blank values skip, strings trim, false and zero survive, identifiers stay strings',()=>{
  const result=check({schemaVersion:1,personal:{surname:'  A  B  ',givenNames:'  ',hasViolations:false,violations:[]},passport:{number:' 00123 '},contact:{phone:'+00123',emergency:null},visa:{},expenses:{estimatedAmount:0,hasInsurance:false}});
  assert.equal(result.ok,true);assert.equal(result.data.personal.surname,'A  B');assert.equal(result.data.passport.number,'00123');assert.equal(result.data.contact.phone,'+00123');assert.equal(result.data.expenses.estimatedAmount,0);assert.equal(result.data.personal.hasViolations,false);assert.equal(result.data.personal.violations,undefined);assert.equal(result.data.visa,undefined);
  assert.ok(result.skipped.some(e=>e.path==='personal.givenNames'));
});
test('type boundaries and calendar validation',()=>{
  for(const date of ['2000-02-29','2024-02-29','2025-12-31'])assert.equal(isCalendarDate(date),true);
  for(const date of ['1900-02-29','2025-02-29','2025-04-31','2025-00-01','0000-01-01','2025-1-01','2025-01-01T00:00:00Z'])bad({schemaVersion:1,personal:{dateOfBirth:date}});
  for(const [group,key,value]of [['personal','yearOfBirth',999],['personal','yearOfBirth',10000],['personal','yearOfBirth',1990.5],['trip','durationDays',0],['trip','durationDays',1.5],['expenses','estimatedAmount',-1],['expenses','hasInsurance','false'],['passport','number',123]])bad({schemaVersion:1,[group]:{[key]:value}});
  assert.equal(check({schemaVersion:1,personal:{yearOfBirth:1000},trip:{durationDays:1}}).ok,true);
  for(const value of [{personal:[]},{personal:{surname:[]}},{trip:{previousVisits:{}}},{expenses:{estimatedAmount:'0'}}])bad({schemaVersion:1,...value});
  assert.equal(check({schemaVersion:1,personal:{dateOfBirth:' 2000-02-29 '}}).data.personal.dateOfBirth,'2000-02-29');
});
test('DOB, email, insurance and all date interval contradictions',()=>{
  for(const fields of [{personal:{dateOfBirth:'1990-01-01',yearOfBirth:1990}},{personal:{email:'a@example.invalid',confirmEmail:'b@example.invalid'}},{expenses:{hasInsurance:false,insuranceDetails:'Policy'}},{passport:{dateOfIssue:'2026-01-01',dateOfExpiry:'2025-01-01'}},{visa:{validFrom:'2026-01-01',validTo:'2025-01-01'}},{trip:{previousVisits:[{from:'2026-01-01',to:'2025-01-01',purpose:'Tourism'}]}},{passport:{otherValidPassports:[{type:'Ordinary',number:'001',placeOfIssue:'Example',dateOfIssue:'2026-01-01',dateOfExpiry:'2025-01-01'}]}}])bad({schemaVersion:1,...fields});
  assert.equal(check({schemaVersion:1,personal:{email:'a@example.invalid'},expenses:{payer:'Unknown runtime choice',sponsor:{name:'EXAMPLE'}}}).ok,true);
});
test('every full record requires every mandatory cell and rejects empty or unknown cells',()=>{
  for(const [list,control]of Object.entries(LIST_CONTROLS)){
    const [group,key]=list.split('.');
    const row=key==='otherNationalities'?'Example':Object.fromEntries(Object.entries(RECORDS[key]).map(([name,type])=>[name,type==='date'?'2025-01-01':'Example']));
    const result=check({schemaVersion:1,[group]:{[key]:[row]}});assert.equal(result.ok,true,list);assert.equal(result.data[group][control.split('.')[1]],true);
    bad({schemaVersion:1,[group]:{[key]:[row],[control.split('.')[1]]:false}});
    for(const item of [null,'',{}])bad({schemaVersion:1,[group]:{[key]:[item]}});
    if(typeof row==='object')for(const name of Object.keys(row).filter(n=>n!=='typeDetails'))for(const absent of [undefined,null,'  '])bad({schemaVersion:1,[group]:{[key]:[{...row,[name]:absent}]}});
  }
});
test('schema covers the same fields and raw optional semantics',()=>{
  const schema=JSON.parse(readFileSync(new URL('../schema/application.schema.json',import.meta.url),'utf8'));
  assert.deepEqual(schema.required,['schemaVersion']);assert.equal(schema.properties.schemaVersion.const,1);assert.equal(schema.additionalProperties,false);
  const unwrap=rule=>rule.anyOf?.[2]??rule;
  function compare(definition,rule,prefix=''){
    assert.equal(rule.additionalProperties,false);
    assert.deepEqual(Object.keys(rule.properties).sort(),Object.keys(definition).sort());
    for(const [key,type]of Object.entries(definition)){
      const child=unwrap(rule.properties[key]);if(typeof type==='object')compare(type,child,`${prefix}.${key}`);
      else if(type==='records')compare(RECORDS[key],child.items);
    }
  }
  for(const [group,definition]of Object.entries(GROUPS))compare(definition,unwrap(schema.properties[group]));
  assert.equal(Object.keys(FIELDS).length,64);
});
