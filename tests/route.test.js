import test from 'node:test';
import assert from 'node:assert/strict';
import {isPersonalFormUrl,personalFormMode} from '../extension/shared/route.js';
test('shared route accepts base and one saved ID while rejecting nested routes',()=>{
  assert.equal(isPersonalFormUrl('https://evisa.gov.vn/e-visa/foreigners'),true);
  assert.equal(isPersonalFormUrl(new URL('https://evisa.gov.vn/e-visa/foreigners/fake_saved-123/?email=example%40example.invalid#form')),true);
  assert.equal(isPersonalFormUrl('https://evisa.gov.vn/e-visa/foreigners/invalid/nested'),false);
});
test('route distinguishes new and saved forms without exposing query values',()=>{
  assert.equal(personalFormMode('https://evisa.gov.vn/e-visa/foreigners/?test=1#form'),'new');
  assert.equal(personalFormMode('https://evisa.gov.vn/e-visa/foreigners/fake_saved-123?email=example%40example.invalid'),'saved');
  for(const url of ['https://example.invalid/e-visa/foreigners/fake','https://evisa.gov.vn/e-visa/foreigners/invalid/nested','invalid'])assert.equal(personalFormMode(url),null);
});
