import test from 'node:test';
import assert from 'node:assert/strict';
import {groupResults} from '../extension/sidebar/result-groups.js';
test('mixed report prioritizes errors by kind and retains every result in stable per-group order',()=>{
  const rows=[
    {path:'contact.phone',status:'filled'},
    {path:'trip.address',status:'error',reason:'Action not confirmed: unavailable.'},
    {path:'occupation.category',status:'error',reason:'Action not confirmed: timeout.'},
    {path:'personal.sex',status:'changed_by_site'},
    {path:'portrait',status:'error',reason:'Action not confirmed: timeout.'},
    {path:'session',status:'error'},
    {path:'passport.number',status:'skipped_dependency',reason:'OCR completion is not confirmed.'},
    {path:'personal.email',status:'error',reason:'Final value could not be confirmed.'},
    {path:'future.field',status:'future_status'},
    {path:'contact.mailingAddress',status:'filled'},
    {path:'trip.phone',status:'unchanged'},
    {path:'occupation.phone',status:'skipped_empty'}
  ];
  const groups=groupResults(rows);
  assert.deepEqual(groups.map(group=>group.id),['session','images','timeout','unavailable','verification','changed','dependency','filled','unchanged','empty','other']);
  assert.equal(groups.reduce((count,group)=>count+group.results.length,0),rows.length);
  assert.deepEqual(groups.find(group=>group.id==='filled').results,[rows[0],rows[9]]);
  assert.equal(groups.at(-1).results[0],rows[8]);
  assert.equal(groups.find(group=>group.id==='changed').tone,'error');
  assert.equal(groups.find(group=>group.id==='dependency').tone,'neutral');
  assert.equal(groups.find(group=>group.id==='filled').tone,'success');
  assert.equal(groups.find(group=>group.id==='unchanged').tone,'success');
  assert.equal(groups.find(group=>group.id==='empty').tone,'neutral');
  assert.deepEqual(groupResults([]),[]);
});
