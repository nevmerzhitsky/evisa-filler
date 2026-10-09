import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import {RECORDS,LIST_CONTROLS} from '../extension/shared/contract.js';
const read = path => JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const ajv = new Ajv2020({strict:true,allErrors:true});
const validate = ajv.compile(read('../schema/application.schema.json'));
const accepts = data => assert.equal(validate(data),true,JSON.stringify(validate.errors));
const rejects = data => assert.equal(validate(data),false);
const file = groups => ({schemaVersion:1,...groups});
test('schema compiles under strict Draft 2020 and accepts both fictional examples',()=>{
  accepts(read('../examples/minimal.json'));accepts(read('../examples/extended.json'));
});
test('schema requires version and rejects unknown keys at all object levels',()=>{
  for(const value of [{},{schemaVersion:2},{schemaVersion:null},{schemaVersion:'1'},file({unknown:null}),file({personal:{unknown:null}}),file({expenses:{sponsor:{unknown:null}}})])rejects(value);
});
test('raw null and blank fields, empty lists and types',()=>{
  accepts(file({personal:null,passport:'  ',trip:{previousVisits:[],durationDays:null},expenses:{hasInsurance:' ',estimatedAmount:0},contact:{emergency:''}}));
  accepts(file({personal:{surname:'',hasViolations:false},passport:{number:'00123'},contact:{phone:'+00123'}}));
  for(const value of [{personal:[]},{personal:{surname:[]}},{personal:{yearOfBirth:'1990'}},{expenses:{estimatedAmount:-1}},{expenses:{hasInsurance:0}},{trip:{durationDays:0}},{trip:{previousVisits:{}}},{passport:{number:1}}])rejects(file(value));
});
test('all list records require every mandatory nonempty cell and reject unknown cells',()=>{
  for(const [list,control]of Object.entries(LIST_CONTROLS)){
    const [group,key]=list.split('.');
    const row=key==='otherNationalities'?'Example':Object.fromEntries(Object.entries(RECORDS[key]).map(([name,type])=>[name,type==='date'?'2025-01-01':'Example']));
    const input=item=>file({[group]:{[key]:[item]}});
    accepts(input(row));
    for(const item of [null,'',{},'   ',false])rejects(input(item));
    if(typeof row==='object'){
      rejects(input({...row,unknown:null}));
      for(const name of Object.keys(row).filter(name=>name!=='typeDetails')){
        const missing={...row};delete missing[name];rejects(input(missing));
        for(const blank of [null,'','  '])rejects(input({...row,[name]:blank}));
      }
      if(key==='otherValidPassports'){
        const missing={...row};delete missing.typeDetails;accepts(input(missing));
        accepts(input({...row,typeDetails:null}));accepts(input({...row,typeDetails:' '}));
      }
    }
    rejects(file({[group]:{[key]:[row],[control.split('.')[1]]:false}}));
    accepts(file({[group]:{[key]:[],[control.split('.')[1]]:false}}));
  }
});
test('DOB and year conflict only when both supply values',()=>{
  rejects(file({personal:{dateOfBirth:'2000-01-01',yearOfBirth:2000}}));
  for(const blank of [null,'','  ']){
    accepts(file({personal:{dateOfBirth:blank,yearOfBirth:2000}}));
    accepts(file({personal:{dateOfBirth:'2000-01-01',yearOfBirth:blank}}));
  }
});
test('insurance false conflicts with supplied details, with blank exemptions',()=>{
  rejects(file({expenses:{hasInsurance:false,insuranceDetails:'Policy'}}));
  for(const blank of [null,'','  '])accepts(file({expenses:{hasInsurance:false,insuranceDetails:blank}}));
  accepts(file({expenses:{insuranceDetails:'Policy'}}));
});
test('dates allow trimming but still require the lexical YYYY-MM-DD form',()=>{
  accepts(file({personal:{dateOfBirth:' 2000-02-29 '}}));
  for(const date of ['2000-2-29','2000-02-29T00:00:00Z','yesterday'])rejects(file({personal:{dateOfBirth:date}}));
  // Calendar validity and cross-field ordering are deliberately runtime validator checks.
});
