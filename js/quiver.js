// Quiver AI Arrow 2 client for Vector Iris. Shared by the Illustrator panel
// (CEP with Node: Node https) and the Figma plugin (browser iframe: fetch;
// Quiver allows cross-origin calls). Also runs in plain Node for testing.
// API: https://docs.quiver.ai
(function () {
  'use strict';

  const https = typeof require === 'function' ? require('https') : null;

  const HOST = 'api.quiver.ai';
  const TIMEOUT_MS = 10 * 60 * 1000; // high effort on a big canvas can take ~3 minutes
  // USD per 1M tokens, [input, output]
  const PRICES = { 'arrow-2': [4, 20], 'arrow-2-telos': [6, 30] };
  const FRAME_ID = 'vi-frame';

  // opts: { mode: 'trace'|'redraw'|'generate', model, effort, width, height,
  //         imageBase64 (trace/redraw; optional style reference for generate),
  //         prompt, instructions, maxOutputTokens }
  // width/height set the aspect ratio: the image's pixels, or the chosen format.
  function buildRequest(o) {
    // viewBox keeps the aspect ratio with a 1024 long side (cost tracks canvas size).
    const long = Math.max(o.width, o.height) || 1;
    const vw = Math.max(1, Math.round(o.width / long * 1024));
    const vh = Math.max(1, Math.round(o.height / long * 1024));
    const body = {
      model: o.model || 'arrow-2',
      stream: false,
      reasoning_effort: o.effort || 'low',
      max_output_tokens: o.maxOutputTokens || 65536,
      attributes: { viewBox: { minX: 0, minY: 0, width: vw, height: vh } },
    };
    if (o.mode === 'trace') {
      body.image = { base64: o.imageBase64 };
      return { path: '/v1/svgs/vectorizations', body };
    }
    const fallback = o.mode === 'redraw' ? 'Recreate this image as clean, flat vector artwork.' : '';
    body.prompt = (o.prompt || '').trim() || fallback;
    if (!body.prompt) throw new Error('Describe what to generate first.');
    if ((o.instructions || '').trim()) body.instructions = o.instructions.trim();
    body.n = 1;
    if (o.imageBase64) body.references = [{ base64: o.imageBase64 }];
    return { path: '/v1/svgs/generations', body };
  }

  // Validates a key without spending credits (GET /v1/models).
  function checkKey(apiKey) {
    if (!https) return checkKeyFetch(apiKey);
    return new Promise((resolve, reject) => {
      const req = https.request({ host: HOST, path: '/v1/models', method: 'GET', headers: { Authorization: `Bearer ${apiKey}` } }, (res) => {
        res.resume();
        res.on('end', () => {
          if (res.statusCode === 401 || res.statusCode === 403) reject(new Error('Quiver did not accept that key.'));
          else if (res.statusCode >= 400) reject(new Error(`Quiver answered ${res.statusCode} while checking the key.`));
          else resolve(true);
        });
      });
      req.setTimeout(20000, () => req.destroy(new Error('Could not reach Quiver to check the key.')));
      req.on('error', (e) => reject(new Error(e.message.startsWith('Could not') ? e.message : `Network error: ${e.message}`)));
      req.end();
    });
  }

  async function checkKeyFetch(apiKey) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 20000);
    let res;
    try {
      res = await fetch(`https://${HOST}/v1/models`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: ctl.signal });
    } catch (e) {
      throw new Error(ctl.signal.aborted ? 'Could not reach Quiver to check the key.' : `Network error: ${e.message}`);
    } finally { clearTimeout(t); }
    if (res.status === 401 || res.status === 403) throw new Error('Quiver did not accept that key.');
    if (res.status >= 400) throw new Error(`Quiver answered ${res.status} while checking the key.`);
    return true;
  }

  function friendlyError(status, json, raw) {
    const msg = (json && (json.message || (json.error && json.error.message))) || '';
    if (status === 401) return 'Quiver rejected the API key. Check it in Settings.';
    if (status === 402) return 'Out of Quiver credits. Top up at quiver.ai.';
    if (status === 429) return `Quiver is rate limiting. Try again in ${json && json.retry_after ? json.retry_after + 's' : 'a moment'}.`;
    if (status === 400) return `Quiver refused the request: ${msg || 'bad request'}`;
    return `Quiver error ${status}: ${msg || String(raw).slice(0, 200)}`;
  }

  // Returns { promise, cancel }. The promise resolves to
  // { svg, usage, cost, id, seconds } or rejects with a readable Error.
  function request(apiKey, req) {
    if (!https) return requestFetch(apiKey, req);
    let httpReq = null;
    let canceled = false;
    const started = Date.now();

    const promise = new Promise((resolve, reject) => {
      const data = Buffer.from(JSON.stringify(req.body));
      httpReq = https.request({
        host: HOST,
        path: req.path,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': data.length,
        },
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = JSON.parse(raw); } catch (e) { /* non-JSON error page */ }
          if (res.statusCode >= 400 || !json) {
            reject(new Error(friendlyError(res.statusCode, json, raw)));
            return;
          }
          const svg = json.data && json.data[0] && json.data[0].svg;
          if (!svg) { reject(new Error('Quiver answered without an SVG.')); return; }
          if (!/<\/svg>\s*$/.test(svg)) {
            reject(new Error('The SVG was cut off (hit the output token limit). Try lower detail or a smaller subject.'));
            return;
          }
          resolve({
            svg,
            id: json.id,
            usage: json.usage || {},
            cost: estimateCost(req.body.model, json.usage),
            seconds: Math.round((Date.now() - started) / 1000),
          });
        });
      });
      // Quiver sends nothing until the SVG is done, and slow runs (Telos, high
      // effort) can sit silent for minutes. Keepalive probes stop routers and
      // proxies from dropping the idle connection (seen as ECONNRESET at ~35s).
      httpReq.on('socket', (sock) => sock.setKeepAlive(true, 10000));
      httpReq.setTimeout(TIMEOUT_MS, () => httpReq.destroy(new Error('Quiver took longer than 10 minutes. Try lower effort.')));
      httpReq.on('error', (e) => reject(canceled ? new Error('Canceled.') : new Error(e.message.startsWith('Quiver') ? e.message : `Network error: ${e.message}`)));
      httpReq.end(data);
    });

    return {
      promise,
      cancel() { canceled = true; if (httpReq) httpReq.destroy(); },
    };
  }

  // Parses a finished response body into the shape request() resolves with.
  function parseResult(status, raw, req, started) {
    let json = null;
    try { json = JSON.parse(raw); } catch (e) { /* non-JSON error page */ }
    if (status >= 400 || !json) throw new Error(friendlyError(status, json, raw));
    const svg = json.data && json.data[0] && json.data[0].svg;
    if (!svg) throw new Error('Quiver answered without an SVG.');
    if (!/<\/svg>\s*$/.test(svg)) throw new Error('The SVG was cut off (hit the output token limit). Try lower detail or a smaller subject.');
    return {
      svg,
      id: json.id,
      usage: json.usage || {},
      cost: estimateCost(req.body.model, json.usage),
      seconds: Math.round((Date.now() - started) / 1000),
    };
  }

  // Browser version of request() (Figma). The browser owns the socket, so the
  // keepalive trick above isn't available here.
  function requestFetch(apiKey, req) {
    const ctl = new AbortController();
    let canceled = false, timedOut = false;
    const started = Date.now();
    const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, TIMEOUT_MS);
    const promise = (async () => {
      try {
        const res = await fetch(`https://${HOST}${req.path}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(req.body),
          signal: ctl.signal,
        });
        return parseResult(res.status, await res.text(), req, started);
      } catch (e) {
        if (canceled) throw new Error('Canceled.');
        if (timedOut) throw new Error('Quiver took longer than 10 minutes. Try lower effort.');
        throw e.message && /^(Quiver|The SVG)/.test(e.message) ? e : new Error(`Network error: ${e.message}`);
      } finally { clearTimeout(timer); }
    })();
    return { promise, cancel() { canceled = true; ctl.abort(); } };
  }

  function estimateCost(model, usage) {
    const p = PRICES[model] || PRICES['arrow-2'];
    if (!usage) return 0;
    return ((usage.input_tokens || 0) * p[0] + (usage.output_tokens || 0) * p[1]) / 1e6;
  }

  // Arrow draws as if its canvas were square: given a 1024x801 canvas it drew a
  // trace inside a centered 801x626 box. So images go in padded to a square
  // (never stretched) on a square canvas, and the SVG's viewBox is cropped back
  // to the image's area afterward.
  //   squarePlan(w, h) -> { size, box: [x, y, w, h] } in canvas units
  function squarePlan(w, h, size) {
    size = size || 1024;
    const long = Math.max(w, h) || 1;
    const bw = w / long * size, bh = h / long * size;
    return { size, box: [(size - bw) / 2, (size - bh) / 2, bw, bh] };
  }
  const r2 = (n) => Math.round(n * 100) / 100;
  function cropTo(svg, box) {
    const open = svg.match(/<svg\b[^>]*>/i);
    if (!open) return svg;
    const [x, y, w, h] = box.map(r2);
    let tag = open[0]
      .replace(/\s(viewBox|width|height)\s*=\s*("[^"]*"|'[^']*')/gi, '')
      .replace(/^<svg\b/i, `<svg viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}"`);
    return svg.slice(0, open.index) + tag + svg.slice(open.index + open[0].length);
  }

  // Add an invisible rect matching the viewBox as the first child, so the
  // Illustrator side can size, place and clip the import to the SVG's frame.
  function withFrame(svg) {
    const open = svg.match(/<svg\b[^>]*>/i);
    if (!open) return svg;
    let x = 0, y = 0, w = 0, h = 0;
    const vb = open[0].match(/viewBox\s*=\s*["']([^"']+)["']/i);
    if (vb) {
      const n = vb[1].trim().split(/[\s,]+/).map(Number);
      if (n.length === 4 && n.every(isFinite)) [x, y, w, h] = n;
    }
    if (!(w > 0 && h > 0)) {
      const wm = open[0].match(/\bwidth\s*=\s*["']([\d.]+)/i), hm = open[0].match(/\bheight\s*=\s*["']([\d.]+)/i);
      w = wm ? +wm[1] : 0; h = hm ? +hm[1] : 0;
    }
    if (!(w > 0 && h > 0)) return svg;
    const rect = `<rect id="${FRAME_ID}" x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="none"/>`;
    const at = open.index + open[0].length;
    return svg.slice(0, at) + rect + svg.slice(at);
  }

  const api = { buildRequest, request, checkKey, estimateCost, withFrame, squarePlan, cropTo, PRICES };
  if (typeof window !== 'undefined') window.QuiverAPI = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
