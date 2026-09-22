// Quiver AI Arrow 2 client for Vector Iris. Runs in the panel (CEP with Node
// enabled) and in plain Node for testing. API: https://docs.quiver.ai
(function () {
  'use strict';

  const https = require('https');

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
      httpReq.setTimeout(TIMEOUT_MS, () => httpReq.destroy(new Error('Quiver took longer than 10 minutes. Try lower detail.')));
      httpReq.on('error', (e) => reject(canceled ? new Error('Canceled.') : new Error(e.message.startsWith('Quiver') ? e.message : `Network error: ${e.message}`)));
      httpReq.end(data);
    });

    return {
      promise,
      cancel() { canceled = true; if (httpReq) httpReq.destroy(); },
    };
  }

  function estimateCost(model, usage) {
    const p = PRICES[model] || PRICES['arrow-2'];
    if (!usage) return 0;
    return ((usage.input_tokens || 0) * p[0] + (usage.output_tokens || 0) * p[1]) / 1e6;
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

  const api = { buildRequest, request, checkKey, estimateCost, withFrame, PRICES };
  if (typeof window !== 'undefined') window.QuiverAPI = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
