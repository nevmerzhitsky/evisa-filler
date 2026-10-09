import test from 'node:test';
import assert from 'node:assert/strict';
import {isPersonalFormUrl} from '../extension/shared/route.js';
test('shared route accepts base and one saved ID while rejecting nested routes',()=>{
  assert.equal(isPersonalFormUrl('https://evisa.gov.vn/e-visa/foreigners'),true);
  assert.equal(isPersonalFormUrl(new URL('https://evisa.gov.vn/e-visa/foreigners/fake_saved-123/?email=example%40example.invalid#form')),true);
  assert.equal(isPersonalFormUrl('https://evisa.gov.vn/e-visa/foreigners/invalid/nested'),false);
});
