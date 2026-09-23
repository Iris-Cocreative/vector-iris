// Vector Iris for Figma: the UI iframe. Onboarding, settings, the
// export -> Quiver -> place flow, progress and history (the counterpart of js/panel.js).
(() => {
  'use strict';

  const VERSION = '0.1.0';
  const $ = (id) => document.getElementById(id);

  // ---------- main-thread bridge ----------

  let nextId = 1;
  const pending = new Map();
  function main(type, args) {
    return new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      parent.postMessage({ pluginMessage: Object.assign({ type, id }, args) }, '*');
    });
  }

  // ---------- settings (figma.clientStorage, via the main thread) ----------

  const defaults = {
    apiKey: '',
    mode: 'trace',
    effort: 'low',
    model: 'arrow-2-telos',
    size: 2048,
    format: '1:1',
    useRef: false,
    gap: 24,
    prompts: { redraw: '', generate: '' },
    instructions: '',
    history: [],
  };
  let S = Object.assign({}, defaults);

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => main('saveSettings', { settings: S }), 250);
  }

  function openURL(url) { main('openURL', { url }); }
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-url]');
    if (a) { e.preventDefault(); openURL(a.dataset.url); }
  });

  // ---------- screens ----------

  function showScreen() {
    $('welcome').hidden = !!S.apiKey;
    $('main').hidden = !S.apiKey;
  }

  async function connect(key, statusEl) {
    key = key.trim();
    if (!key) return false;
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
  let sel = { count: 0, images: 0, label: '' };

  const usesImage = () => S.mode !== 'generate' || (S.useRef && sel.count > 0);

  function renderSource() {
    const box = $('source');
    const generateNew = S.mode === 'generate' && !(S.useRef && sel.count);
    box.classList.toggle('ready', !generateNew && sel.count > 0);
    box.classList.toggle('new', generateNew);
    box.dataset.kind = generateNew ? 'new' : !sel.count ? 'empty' : sel.images === sel.count ? 'image' : 'art';
    $('use-ref').disabled = !sel.count;
    $('size-row').hidden = !usesImage();

    let name, hint;
    if (generateNew) { name = 'New artwork'; hint = 'Placed in the center of your view.'; }
    else if (!sel.count) { name = 'Nothing selected'; hint = S.mode === 'generate' ? 'Select a layer to use as a style reference.' : 'Select an image on the canvas.'; }
    else {
      name = sel.label;
      if (S.mode === 'generate') hint = 'Style reference. The result goes beside it.';
      else if (sel.images === sel.count) hint = sel.count === 1 ? 'Ready. The result goes beside it.' : `${sel.count} images, exported together.`;
      else hint = 'Layers will be rasterized, then vectorized.';
    }
    $('source-name').textContent = name;
    $('source-hint').textContent = hint;
  }

  // ---------- controls ----------

  const HINTS = {
    trace: 'Follows the pixels closely, gradients included. Best for logos, scans and flat art.',
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
    $('gap').value = S.gap;
    $('go').textContent = S.mode === 'generate' ? 'Generate' : 'Vectorize';
    $('version').textContent = `Vector Iris for Figma ${VERSION}`;
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
  $('gap').addEventListener('change', (e) => set({ gap: Math.max(0, +e.target.value || 0) }));

  $('key-save').addEventListener('click', async () => {
    if (await connect($('key').value, $('status'))) { $('key').value = ''; renderKeyState(); }
  });
  $('forget-key').addEventListener('click', (e) => {
    e.preventDefault();
    set({ apiKey: '' });
    showScreen();
  });

  // ---------- history ----------
  // Figma plugins can't write files, so each result's SVG stays downloadable
  // for this session; "Show" finds the placed layer in the file any time.

  const MODE_WORD = { trace: 'Trace', redraw: 'Redraw', generate: 'Generate' };
  const sessionSVGs = new Map(); // nodeId -> svg text

  function downloadSVG(filename, svg) {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

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
      const links = document.createElement('span');
      links.className = 'h-links';
      if (h.nodeId) {
        const show = document.createElement('a');
        show.textContent = 'Show';
        show.addEventListener('click', async () => {
          const r = await main('show', { nodeId: h.nodeId });
          if (!r.ok) setStatus(r.error, 'error');
        });
        links.append(show);
      }
      const svg = h.nodeId && sessionSVGs.get(h.nodeId);
      if (svg) {
        const dl = document.createElement('a');
        dl.textContent = 'SVG';
        dl.title = 'Download the SVG';
        dl.addEventListener('click', () => downloadSVG(h.file, svg));
        links.append(dl);
      }
      li.append(name, links, meta);
      list.append(li);
    }
  }

  // ---------- the flow ----------

  const safeName = (s) => String(s).replace(/[<>:"/\\|?*\x00-\x1f]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 50) || 'vector';
  function stamp() {
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }
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

  function bytesToBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  async function decodePNG(bytes) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally { URL.revokeObjectURL(url); }
  }

  // Arrow reads images as if they were square (a wide image comes back squeezed
  // into a centered box). Pad to a square without stretching; the SVG is
  // cropped back to the image's area after (QuiverAPI.squarePlan / cropTo).
  function squareImage(img) {
    const w = img.naturalWidth, h = img.naturalHeight, size = Math.max(w, h);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    c.getContext('2d').drawImage(img, Math.round((size - w) / 2), Math.round((size - h) / 2), w, h);
    let b64 = c.toDataURL('image/png').split(',')[1];
    // Quiver's limit is 12 MiB decoded; a padded 4096 px PNG photo can pass it.
    if (b64.length * 0.75 > 11.5 * 1024 * 1024) {
      const ctx = c.getContext('2d');
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      b64 = c.toDataURL('image/jpeg', 0.9).split(',')[1];
    }
    return b64;
  }

  async function go() {
    if (running) return;
    const mode = S.mode;
    const withImage = usesImage();
    const prompt = S.prompts[mode] || '';
    if (mode === 'generate' && !prompt.trim()) { setStatus('Describe what to generate first.', 'error'); $('prompt').focus(); return; }

    running = {};
    busy(true, withImage ? 'Exporting from Figma' : 'Preparing');
    setStatus('');

    try {
      let ex = null, imageBase64 = null, width, height, crop = null;
      if (withImage) {
        ex = await main('exportSelection', { maxPx: S.size });
        if (!ex.ok) throw new Error(ex.error);
        if (mode === 'generate') {
          // A style reference only guides the look; the canvas follows the chosen format.
          imageBase64 = bytesToBase64(ex.bytes);
          [width, height] = S.format.split(':').map(Number);
        } else {
          const img = await decodePNG(ex.bytes);
          imageBase64 = squareImage(img);
          width = height = 1;
          crop = QuiverAPI.squarePlan(img.naturalWidth, img.naturalHeight).box;
        }
      } else {
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
      if (crop) res.svg = QuiverAPI.cropTo(res.svg, crop);

      const label = mode === 'generate' ? promptLabel(prompt) : ex.label;
      const file = `${safeName(label)} ${mode} ${stamp()}.svg`;

      busy(true, 'Placing in Figma');
      const name = `Vector Iris ${MODE_WORD[mode].toLowerCase()}: ${label}`;
      const pl = await main('place', withImage
        ? { svg: res.svg, name, target: 'beside', bounds: ex.bounds, gap: S.gap }
        : { svg: res.svg, name, target: 'view', viewFraction: 0.5 });

      const tokens = res.usage.total_tokens || (res.usage.input_tokens || 0) + (res.usage.output_tokens || 0);
      if (pl.ok) sessionSVGs.set(pl.nodeId, res.svg);
      S.history.unshift({ name: label, mode, seconds: res.seconds, tokens, cost: res.cost, file, nodeId: pl.ok ? pl.nodeId : null });
      S.history = S.history.slice(0, 20);
      save();
      renderHistory();

      if (!pl.ok) {
        // Nothing landed in the file, so hand the SVG over directly.
        downloadSVG(file, res.svg);
        setStatus(`Could not place it: ${pl.error} The SVG was downloaded instead.`, 'error');
      } else setStatus(`Done in ${res.seconds}s, about $${res.cost.toFixed(3)}.`, 'ok');
    } catch (e) {
      setStatus(e.message || String(e), 'error');
    } finally {
      busy(false);
    }
  }

  $('go').addEventListener('click', go);
  $('cancel').addEventListener('click', () => {
    if (running && running.cancel) running.cancel();
    setStatus('Canceling. Quiver may still bill for work already done.');
  });

  // ---------- messages from the main thread ----------

  window.onmessage = (e) => {
    const msg = e.data && e.data.pluginMessage;
    if (!msg) return;
    if (msg.type === 'reply') {
      const resolve = pending.get(msg.id);
      if (resolve) { pending.delete(msg.id); resolve(msg); }
    } else if (msg.type === 'init') {
      S = Object.assign({}, defaults, msg.settings);
      S.prompts = Object.assign({}, defaults.prompts, S.prompts);
      sel = msg.selection;
      render();
      showScreen();
    } else if (msg.type === 'selection') {
      sel = msg.selection;
      renderSource();
    }
  };
})();
