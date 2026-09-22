// Vector Iris panel: onboarding, settings, the export → Quiver → place flow, progress and history.
(() => {
  'use strict';

  const VERSION = '0.2.0';
  const cep = window.__adobe_cep__;
  const node = typeof require === 'function';
  const fs = node ? require('fs') : null;
  const path = node ? require('path') : null;
  const os = node ? require('os') : null;
  const $ = (id) => document.getElementById(id);

  // ---------- settings (a JSON file outside the plugin, so the key never lives in code) ----------

  const SETTINGS_FILE = node
    ? path.join(process.env.APPDATA || path.join(os.homedir(), 'Library', 'Application Support'), 'IrisCocreative', 'VectorIris', 'settings.json')
    : null;

  const defaults = {
    apiKey: '',
    mode: 'trace',
    effort: 'low',
    model: 'arrow-2-telos',
    size: 2048,
    format: '1:1',
    useRef: false,
    outDir: node ? path.join(os.homedir(), 'Documents', 'Vector Iris') : '',
    gap: 24,
    prompts: { redraw: '', generate: '' },
    instructions: '',
    history: [],
  };

  function loadSettings() {
    if (!node) return {};
    try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8').replace(/^\uFEFF/, '')); } catch (e) { return {}; }
  }
  const S = Object.assign({}, defaults, loadSettings());
  S.prompts = Object.assign({}, defaults.prompts, S.prompts);
  // Settings carried over from the pre-release "Quiver Trace" build.
  if (typeof S.prompt === 'string') { S.prompts.redraw = S.prompts.redraw || S.prompt; delete S.prompt; }
  if (/Quiver Traces$/.test(S.outDir)) S.outDir = defaults.outDir;

  function save() {
    if (!node) return;
    try {
      fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(S, null, 2));
    } catch (e) { setStatus(`Could not save settings: ${e.message}`, 'error'); }
  }

  // ---------- host bridge ----------

  function evalRaw(script) {
    return new Promise((resolve) => { if (!cep) resolve(null); else cep.evalScript(script, resolve); });
  }
  async function host(fn, arg) {
    if (!cep) return { ok: false, error: 'Open this panel inside Illustrator (Window > Extensions).' };
    const raw = await evalRaw(`VI.${fn}(${arg === undefined ? '' : JSON.stringify(arg)})`);
    try { return JSON.parse(raw); } catch (e) { return { ok: false, error: raw || 'Illustrator did not answer.' }; }
  }
  async function ensureHost() {
    if (!cep) return;
    if ((await evalRaw('typeof VI')) === 'object') return;
    let p = decodeURI(cep.getSystemPath('extension'));
    p = /^Win/.test(navigator.platform) ? p.replace('file:///', '') : p.replace('file://', '');
    await evalRaw(`$.evalFile(${JSON.stringify(p + '/jsx/host.jsx')})`);
  }

  function openURL(url) {
    if (window.cep && window.cep.util && window.cep.util.openURLInDefaultBrowser) window.cep.util.openURLInDefaultBrowser(url);
    else if (node) require('child_process').exec(process.platform === 'win32' ? `start "" "${url}"` : `open "${url}"`);
    else window.open(url, '_blank');
  }
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-url]');
    if (a) { e.preventDefault(); openURL(a.dataset.url); }
  });

  function reveal(target, select) {
    if (!node) return;
    const cp = require('child_process');
    if (process.platform === 'win32') cp.exec(select ? `explorer /select,"${target}"` : `explorer "${target}"`);
    else cp.exec(select ? `open -R "${target}"` : `open "${target}"`);
  }

  // ---------- screens ----------

  function showScreen() {
    $('welcome').hidden = !!S.apiKey;
    $('main').hidden = !S.apiKey;
    if (S.apiKey) refreshSelection();
  }

  async function connect(key, statusEl) {
    key = key.trim();
    if (!key) return false;
    if (!node) { statusEl.textContent = 'Open this panel inside Illustrator.'; return false; }
    statusEl.className = 'status';
    statusEl.textContent = 'Checking the key with Quiver...';
    try {
      await QuiverAPI.checkKey(key);
    } catch (e) {
      statusEl.className = 'status error';
      statusEl.textContent = e.message;
      return false;
    }
    S.apiKey = key;
    save();
    statusEl.className = 'status ok';
    statusEl.textContent = 'Connected.';
    return true;
  }

  $('welcome-connect').addEventListener('click', async () => {
    if (await connect($('welcome-key').value, $('welcome-status'))) {
      $('welcome-key').value = '';
      render();
      showScreen();
      setStatus('Connected to Quiver. Select an image, or switch to Generate.', 'ok');
    }
  });
  $('welcome-key').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('welcome-connect').click(); });

  // ---------- status + selection ----------

  function setStatus(text, kind) {
    const el = $('status');
    el.textContent = text || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  let running = null; // { cancel, timer, t0 }
  let sel = { count: 0, images: 0, label: '', docName: '' };

  const usesImage = () => S.mode !== 'generate' || (S.useRef && sel.count > 0);

  async function refreshSelection() {
    if (running || !S.apiKey) return;
    const r = await host('selectionInfo');
    if (!r || !r.ok) {
      sel = { count: 0 };
      $('source-name').textContent = 'Not connected to Illustrator';
      $('source-hint').textContent = r ? r.error : '';
      return;
    }
    sel = r;
    renderSource();
  }

  function renderSource() {
    const box = $('source');
    const generateNew = S.mode === 'generate' && !(S.useRef && sel.count);
    box.classList.toggle('ready', !generateNew && sel.count > 0);
    box.classList.toggle('new', generateNew);
    $('use-ref').disabled = !sel.count;
    $('size-row').hidden = !usesImage();

    let name, hint;
    if (sel.doc === false) { name = 'No document'; hint = 'Open a document to begin.'; }
    else if (generateNew) { name = 'New artwork'; hint = 'Placed in the center of your view.'; }
    else if (!sel.count) { name = 'Nothing selected'; hint = S.mode === 'generate' ? 'Select artwork to use as a style reference.' : 'Select an image on the artboard.'; }
    else {
      name = sel.label;
      if (S.mode === 'generate') hint = 'Style reference. The result goes beside it.';
      else if (sel.images === sel.count) hint = sel.count === 1 ? 'Ready. The result goes beside it.' : `${sel.count} images, exported together.`;
      else hint = 'Artwork will be rasterized, then vectorized.';
    }
    $('source-name').textContent = name;
    $('source-hint').textContent = hint;
  }

  // ---------- controls ----------

  const HINTS = {
    trace: 'Follows the pixels closely, keeping gradients and blur. Best for logos, scans and flat art.',
    redraw: 'Rebuilds the image from flat shapes, guided by a prompt. Best for photos and people.',
    generate: 'Creates new vector artwork from a description.',
  };
  const PLACEHOLDERS = {
    redraw: 'Recreate this image as clean, flat vector artwork.',
    generate: 'A minimal line icon of a paper crane, single weight stroke.',
  };

  function renderKeyState() {
    const el = $('key-state');
    if (S.apiKey) { el.textContent = `connected, ends ${S.apiKey.slice(-4)}`; el.className = 'set'; }
    else { el.textContent = 'not set'; el.className = 'unset'; }
  }

  function render() {
    for (const b of $('mode').querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.v === S.mode));
    for (const b of $('effort').querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.v === S.effort));
    $('mode-hint').textContent = HINTS[S.mode];
    $('prompt-fields').hidden = S.mode === 'trace';
    for (const el of document.querySelectorAll('.gen-only')) el.hidden = S.mode !== 'generate';
    $('prompt').placeholder = PLACEHOLDERS[S.mode] || '';
    $('prompt').value = S.prompts[S.mode] || '';
    $('instructions').value = S.instructions;
    $('format').value = S.format;
    $('use-ref').checked = S.useRef;
    $('model').value = S.model;
    $('size').value = String(S.size);
    $('outdir').value = S.outDir;
    $('gap').value = S.gap;
    $('go').textContent = S.mode === 'generate' ? 'Generate' : 'Vectorize';
    $('version').textContent = `Vector Iris ${VERSION}`;
    renderKeyState();
    renderSource();
    renderHistory();
  }

  function set(patch) { Object.assign(S, patch); render(); save(); }

  $('mode').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) set({ mode: b.dataset.v }); });
  $('effort').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) set({ effort: b.dataset.v }); });
  $('model').addEventListener('change', (e) => set({ model: e.target.value }));
  $('size').addEventListener('change', (e) => set({ size: +e.target.value }));
  $('format').addEventListener('change', (e) => set({ format: e.target.value }));
  $('use-ref').addEventListener('change', (e) => set({ useRef: e.target.checked }));
  $('prompt').addEventListener('input', (e) => { S.prompts[S.mode] = e.target.value; save(); });
  $('instructions').addEventListener('input', (e) => { S.instructions = e.target.value; save(); });
  $('outdir').addEventListener('change', (e) => set({ outDir: e.target.value.trim() || defaults.outDir }));
  $('gap').addEventListener('change', (e) => set({ gap: Math.max(0, +e.target.value || 0) }));

  $('key-save').addEventListener('click', async () => {
    const statusEl = $('status');
    if (await connect($('key').value, statusEl)) { $('key').value = ''; renderKeyState(); }
  });
  $('forget-key').addEventListener('click', (e) => {
    e.preventDefault();
    set({ apiKey: '' });
    showScreen();
  });
  $('outdir-open').addEventListener('click', () => {
    try { fs.mkdirSync(S.outDir, { recursive: true }); } catch (e) { /* reveal reports it */ }
    reveal(S.outDir, false);
  });

  // ---------- history ----------

  const MODE_WORD = { trace: 'Trace', redraw: 'Redraw', generate: 'Generate' };

  function renderHistory() {
    const list = $('history');
    list.innerHTML = '';
    for (const h of S.history.slice(0, 6)) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'h-name';
      name.textContent = h.name;
      const meta = document.createElement('span');
      meta.className = 'h-meta';
      meta.textContent = `${MODE_WORD[h.mode] || h.mode} · ${h.seconds}s · $${h.cost.toFixed(3)}`;
      meta.title = `${h.tokens.toLocaleString()} tokens`;
      const a = document.createElement('a');
      a.textContent = 'Show';
      a.title = h.file;
      a.addEventListener('click', () => reveal(h.file, true));
      li.append(name, a, meta);
      list.append(li);
    }
  }

  // ---------- the flow ----------

  const safeName = (s) => String(s).replace(/[<>:"/\\|?*\x00-\x1f]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 50) || 'vector';
  function stamp() {
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }
  const slash = (p) => p.replace(/\\/g, '/');
  const promptLabel = (s) => { const t = s.trim().replace(/\s+/g, ' '); return t.length > 40 ? t.slice(0, 40).replace(/\s\S*$/, '') + '...' : t; };

  function busy(on, label) {
    $('go').disabled = on;
    $('cancel').hidden = !on;
    $('progress').hidden = !on;
    if (running && running.timer) clearInterval(running.timer);
    if (on) {
      running = running || {};
      running.t0 = running.t0 || Date.now(); // one clock across all stages
      $('progress-label').textContent = label;
      running.timer = setInterval(() => {
        const s = Math.round((Date.now() - running.t0) / 1000);
        $('elapsed').textContent = s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
      }, 1000);
    } else {
      running = null;
    }
  }

  async function go() {
    if (running) return;
    if (!node) { setStatus('Open this panel inside Illustrator (Window > Extensions).', 'error'); return; }
    await refreshSelection();
    const mode = S.mode;
    const withImage = usesImage();
    const prompt = S.prompts[mode] || '';
    if (mode === 'generate' && !prompt.trim()) { setStatus('Describe what to generate first.', 'error'); $('prompt').focus(); return; }

    const tmpDir = path.join(os.tmpdir(), 'vector-iris');
    fs.mkdirSync(tmpDir, { recursive: true });
    const tmpFiles = [];
    running = {};
    busy(true, withImage ? 'Exporting from Illustrator' : 'Preparing');
    setStatus('');

    try {
      let ex = null, imageBase64 = null, width, height;
      if (withImage) {
        ex = await host('exportSelection', { maxPx: S.size, outBase: slash(path.join(tmpDir, `export-${Date.now()}`)) });
        if (!ex.ok) throw new Error(ex.error);
        tmpFiles.push(ex.file);
        imageBase64 = fs.readFileSync(ex.file).toString('base64');
        width = ex.width; height = ex.height;
      } else {
        if (!sel.docName) throw new Error('Open a document first.');
        [width, height] = S.format.split(':').map(Number);
      }

      const req = QuiverAPI.buildRequest({
        mode, model: S.model, effort: S.effort, imageBase64, width, height,
        prompt, instructions: S.instructions,
      });
      const modelName = S.model === 'arrow-2-telos' ? 'Arrow 2 Telos' : 'Arrow 2';
      const verb = { trace: 'Tracing', redraw: 'Redrawing', generate: 'Generating' }[mode];
      busy(true, `${verb} with ${modelName}`);
      setStatus(S.effort === 'low' || S.effort === 'medium' ? 'Usually 10 to 90 seconds.' : 'High effort can take 2 to 4 minutes.');

      const job = QuiverAPI.request(S.apiKey, req);
      running.cancel = job.cancel;
      const res = await job.promise;

      const label = mode === 'generate' ? promptLabel(prompt) : ex.label;
      fs.mkdirSync(S.outDir, { recursive: true });
      const svgFile = path.join(S.outDir, `${safeName(label)} ${mode} ${stamp()}.svg`);
      fs.writeFileSync(svgFile, res.svg, 'utf8');

      const framed = path.join(tmpDir, `place-${Date.now()}.svg`);
      fs.writeFileSync(framed, QuiverAPI.withFrame(res.svg), 'utf8');
      tmpFiles.push(framed);

      busy(true, 'Placing in Illustrator');
      const name = `Vector Iris ${MODE_WORD[mode].toLowerCase()}: ${label}`;
      const pl = await host('place', withImage
        ? { svgPath: slash(framed), name, target: 'beside', docName: ex.docName, bounds: ex.bounds, gap: S.gap }
        : { svgPath: slash(framed), name, target: 'view', docName: sel.docName, viewFraction: 0.5 });

      const tokens = res.usage.total_tokens || (res.usage.input_tokens || 0) + (res.usage.output_tokens || 0);
      S.history.unshift({ name: label, mode, seconds: res.seconds, tokens, cost: res.cost, file: svgFile });
      S.history = S.history.slice(0, 20);
      save();
      renderHistory();

      if (!pl.ok) setStatus(`${pl.error} Saved: ${svgFile}`, 'error');
      else setStatus(`Done in ${res.seconds}s, about $${res.cost.toFixed(3)}.`, 'ok');
    } catch (e) {
      setStatus(e.message || String(e), 'error');
    } finally {
      for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch (e) { /* already gone */ } }
      busy(false);
      refreshSelection();
    }
  }

  $('go').addEventListener('click', go);
  $('cancel').addEventListener('click', () => {
    if (running && running.cancel) running.cancel();
    setStatus('Canceling. Quiver may still bill for work already done.');
  });

  document.addEventListener('mouseenter', refreshSelection);
  window.addEventListener('focus', refreshSelection);

  // ---------- theme ----------

  function applyTheme() {
    if (!cep) return;
    try {
      const c = JSON.parse(cep.getHostEnvironment()).appSkinInfo.panelBackgroundColor.color;
      document.documentElement.style.setProperty('--bg', `rgb(${c.red | 0}, ${c.green | 0}, ${c.blue | 0})`);
      document.documentElement.dataset.theme = (0.299 * c.red + 0.587 * c.green + 0.114 * c.blue) / 255 > 0.5 ? 'light' : 'dark';
    } catch (e) { /* keep CSS defaults */ }
  }
  if (cep) cep.addEventListener('com.adobe.csxs.events.ThemeColorChanged', applyTheme);

  applyTheme();
  render();
  showScreen();
  ensureHost().then(refreshSelection);
})();
