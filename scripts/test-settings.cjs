// Run with NODE_PATH pointing to a jsdom installation.
const { JSDOM } = require('jsdom');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const version = fs.readFileSync('Cargo.toml', 'utf8').match(/^version\s*=\s*"([^"]+)"/m)[1];
const source = fs.readFileSync('assets/mac-glass-theme/main.js', 'utf8').replaceAll('__MAC_GLASS_VERSION__', version);
let disk = null, failSave = false, failLoad = false;
function boot(legacy) {
  const dom = new JSDOM('<html><body></body></html>', {runScripts: 'dangerously', url: 'https://ncm.local/'});
  const w = dom.window;
  const calls = [];
  let config;
  w.plugin = { onConfig: fn => { config = fn; } };
  if (legacy) w.localStorage.setItem('mac-glass-theme-settings', JSON.stringify(legacy));
  w.betterncm_native = { native_plugin: { call(name, args) {
    if (name === 'mac_glass.settings.load') return JSON.stringify(failLoad ? {ok:false,error:13} : {ok:true,settings:disk && JSON.parse(disk),legacyAlpha:217,legacyEnabled:true});
    if (name === 'mac_glass.settings.save') { if (!failSave) disk=args[0]; return JSON.stringify({saved:!failSave,error:5}); }
    if (name === 'mac_glass.configure') { calls.push(args); return '{"saved":true}'; }
    if (name === 'mac_glass.status') return '{"layered":true,"alpha":217}';
    throw Error(name);
  } } };
  w.eval(source);
  const page = config(); w.document.body.append(page);
  return {w, page, calls, stop() {w.__macGlassTheme.dispose();w.close();}};
}
const values={windowTransparency:33,playbackTransparency:41,opacity:.32,strongOpacity:.45,blur:17,playerOpacity:.67,playerBlur:44,pageOpacity:.56,pageBlur:31,overlay:.12};
const colors={'data-text-color':'#112233','data-text-color-2':'#445566','data-lyrics-color':'#778899','data-lyrics-color-2':'#aabbcc','data-playback-background':'#123456'};
let app=boot({windowTransparency:27,lyricsColor:'#aa1122'});
assert.equal(JSON.parse(disk).windowTransparency,27,'migrate localStorage');
assert.equal(app.calls[0][1],186,'restore before first native configure');
for(const [key,value] of Object.entries(values)) {
  const input=app.page.querySelector(`[data-setting="${key}"] input`);input.value=value;input.dispatchEvent(new app.w.Event('input'));
}
for(const [attr,value] of Object.entries(colors)) {
  const input=app.page.querySelector(`[${attr}]`);input.value=value;input.dispatchEvent(new app.w.Event('input'));
}
for(const attr of ['data-white-text','data-gradient-text','data-lyrics-gradient']) {
  const input=app.page.querySelector(`[${attr}]`);input.checked=true;input.dispatchEvent(new app.w.Event('change'));
}
const saved=JSON.parse(disk);app.stop();
app=boot(); // Entirely new DOM and empty localStorage.
for(const [key,value] of Object.entries(values)) assert.equal(Number(app.page.querySelector(`[data-setting="${key}"] input`).value),value,key);
for(const [attr,value] of Object.entries(colors)) assert.equal(app.page.querySelector(`[${attr}]`).value,value,attr);
assert.equal(app.calls[0][1],171,'no default-alpha overwrite');
assert.equal(app.page.querySelector('[data-lyrics-gradient]').checked,true);
assert.ok(app.page.querySelector('h2').textContent.includes(version));
failSave=true;
const opacity=app.page.querySelector('[data-setting="opacity"] input');opacity.value=.71;opacity.dispatchEvent(new app.w.Event('input'));
assert.match(app.page.querySelector('[data-save-status]').textContent,/保存失败/);
assert.deepEqual(JSON.parse(disk),saved,'write failure preserves last saved file');
failSave=false;
app.page.querySelector('[data-reset]').click();app.stop();
app=boot();assert.equal(Number(app.page.querySelector('[data-setting="windowTransparency"] input').value),20,'reset persists');app.stop();
failLoad=true;const before=disk;app=boot();assert.equal(app.calls.length,0,'read failure must not overwrite native state');assert.equal(disk,before);app.stop();
console.log('PASS: migration, all controls restart with empty cache, native restore order, reset, read/write errors and version.');
