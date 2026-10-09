import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const bootstrap=await readFile(new URL('../extension/content/bootstrap.js',import.meta.url),'utf8');
const manifest=JSON.parse(await readFile(new URL('../extension/manifest.json',import.meta.url),'utf8'));
test('classic bootstrap loads actual adapter/session extension URLs and registers the topframe session',async()=>{
  const window={document:{}},calls=[],registered=[];window.top=window;
  const runtime={getURL:path=>`moz-extension://test/${path}`};
  const script=new vm.Script(bootstrap,{importModuleDynamically:async specifier=>{
    calls.push(specifier);
    return import(specifier.endsWith('adapter.js')?'../extension/content/adapter.js':'../extension/content/session.js');
  }});
  // Run with a module callback stub through replacement of only import calls,
  // keeping the manifest's classic executable bootstrap and registration logic.
  const modules={adapter:{createAdapter:args=>args,isSupportedRoute:()=>true},session:{createSession:args=>registered.push(args)}};
  vm.runInNewContext(bootstrap.replaceAll('import(runtime.getURL(', 'load(runtime.getURL('),{window,document:window.document,browser:{runtime},load:async url=>{calls.push(url);return url.endsWith('adapter.js')?modules.adapter:modules.session;}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(registered.length,1);assert.equal(registered[0].runtime,runtime);assert.equal(registered[0].document,window.document);
  assert.deepEqual(calls,['moz-extension://test/content/adapter.js','moz-extension://test/content/session.js']);assert.equal(registered[0].routeGuard(),true);assert.ok(script);
});
test('subframes never import or register; manifest connects existing sidebar and allows imported modules only on target host',()=>{
  let imported=false;vm.runInNewContext(bootstrap,{window:{top:{}},browser:{runtime:{}},load:()=>{imported=true;}});assert.equal(imported,false);
  assert.equal(manifest.manifest_version,3);assert.equal(manifest.sidebar_action.default_panel,'sidebar/sidebar.html');
  assert.deepEqual(manifest.content_scripts[0].js,['content/bootstrap.js']);assert.equal(manifest.content_scripts[0].all_frames,false);
  assert.deepEqual(manifest.host_permissions,['https://evisa.gov.vn/*']);assert.deepEqual(manifest.web_accessible_resources[0].matches,['https://evisa.gov.vn/*']);
  assert.ok(manifest.web_accessible_resources[0].resources.includes('content/*.js'));assert.ok(!manifest.permissions.includes('storage'));
});
