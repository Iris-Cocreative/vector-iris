// Vector Iris for Figma: the main-thread side (the counterpart of jsx/host.jsx).
// Reads the selection, exports it as PNG, places returned SVGs, and keeps
// settings in figma.clientStorage. The UI iframe (ui.html) talks to Quiver.
//
//   UI -> main: { type, id, ...args }   main -> UI: { type: 'reply', id, ok, ... }
//   main -> UI (unprompted): { type: 'init', settings, selection }, { type: 'selection', ... }

const SETTINGS_KEY = 'vector-iris:settings';

figma.showUI(__html__, { width: 300, height: 640, themeColors: true, title: 'Vector Iris' });

// ---------- selection ----------

function isImageNode(n) {
  if (!('fills' in n) || !Array.isArray(n.fills)) return false;
  return n.fills.some((f) => f.type === 'IMAGE' && f.visible !== false);
}

// An image inside a frame or group still counts as an image.
function containsImage(n) {
  if (isImageNode(n)) return true;
  if ('findOne' in n) return !!n.findOne(isImageNode);
  return false;
}

function labelFor(nodes) {
  if (nodes.length !== 1) return nodes.length + ' objects';
  return nodes[0].name || (containsImage(nodes[0]) ? 'image' : 'artwork');
}

// Visible area on the canvas, masks and effects included.
function renderBounds(nodes) {
  let b = null;
  for (const n of nodes) {
    const r = n.absoluteRenderBounds;
    if (!r) continue; // invisible
    if (!b) b = { x: r.x, y: r.y, x2: r.x + r.width, y2: r.y + r.height };
    else {
      b.x = Math.min(b.x, r.x); b.y = Math.min(b.y, r.y);
      b.x2 = Math.max(b.x2, r.x + r.width); b.y2 = Math.max(b.y2, r.y + r.height);
    }
  }
  return b && { x: b.x, y: b.y, width: b.x2 - b.x, height: b.y2 - b.y };
}

function selectionInfo() {
  const nodes = figma.currentPage.selection;
  let images = 0;
  for (const n of nodes) if (containsImage(n)) images++;
  return { count: nodes.length, images, label: nodes.length ? labelFor(nodes) : '', page: figma.currentPage.name };
}

figma.on('selectionchange', () => figma.ui.postMessage({ type: 'selection', selection: selectionInfo() }));
figma.on('currentpagechange', () => figma.ui.postMessage({ type: 'selection', selection: selectionInfo() }));

// ---------- export ----------

// Several nodes are copied into a temporary frame at their canvas positions so
// they export as one picture, then the frame is removed.
async function exportSelection({ maxPx }) {
  const nodes = figma.currentPage.selection.slice();
  if (!nodes.length) throw new Error('Select an image (or any layer) first.');
  const b = renderBounds(nodes);
  if (!b || b.width < 0.5 || b.height < 0.5) throw new Error('The selection has no visible size.');
  const scale = Math.max(128, Math.min(4096, Number(maxPx) || 2048)) / Math.max(b.width, b.height);

  let target = nodes[0], temp = null;
  if (nodes.length > 1) {
    temp = figma.createFrame();
    temp.name = 'Vector Iris export (temporary)';
    temp.fills = [];
    temp.x = b.x; temp.y = b.y;
    temp.resizeWithoutConstraints(b.width, b.height);
    // Keep stacking order: selection order isn't z-order, so sort by it.
    const ordered = nodes.slice().sort((p, q) => comparePaths(treePath(p), treePath(q)));
    for (const n of ordered) {
      const c = n.clone();
      temp.appendChild(c);
      const t = n.absoluteTransform;
      c.relativeTransform = [[t[0][0], t[0][1], t[0][2] - b.x], [t[1][0], t[1][1], t[1][2] - b.y]];
    }
    target = temp;
  }
  try {
    const bytes = await target.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: scale } });
    return { bytes, bounds: b, label: labelFor(nodes) };
  } finally {
    if (temp) temp.remove();
  }
}

// Child indexes from the page down; comparing them gives paint order (back to front).
function treePath(n) {
  const path = [];
  for (let p = n; p.parent && p.type !== 'PAGE'; p = p.parent) path.unshift(p.parent.children.indexOf(p));
  return path;
}
function comparePaths(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

// ---------- place ----------

// target 'beside': scale to fit `bounds` and sit `gap` px to its right.
// target 'view':   long side = viewFraction of the visible area, centered.
function place({ svg, name, target, bounds, gap, viewFraction }) {
  const node = figma.createNodeFromSvg(svg);
  figma.currentPage.appendChild(node);
  node.name = name || 'Vector Iris';
  node.clipsContent = true; // matches what a browser shows when Arrow draws past the edge
  node.fills = []; // SVG import adds a hidden white fill; drop it so the layer is clean
  const w = node.width, h = node.height;
  let s, x, y;
  if (target === 'view') {
    const v = figma.viewport.bounds;
    s = Math.min(v.width, v.height) * (Number(viewFraction) || 0.5) / Math.max(w, h);
    x = v.x + v.width / 2 - w * s / 2;
    y = v.y + v.height / 2 - h * s / 2;
  } else {
    s = Math.min(bounds.width / w, bounds.height / h);
    x = bounds.x + bounds.width + (Number(gap) || 0);
    y = bounds.y;
  }
  if (w > 0 && h > 0 && isFinite(s) && s > 0) node.rescale(s);
  node.x = x; node.y = y;
  figma.currentPage.selection = [node];
  return { nodeId: node.id, name: node.name };
}

async function show({ nodeId }) {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node || node.removed) throw new Error('That result is no longer in this file.');
  let page = node;
  while (page && page.type !== 'PAGE') page = page.parent;
  if (page && page !== figma.currentPage) await figma.setCurrentPageAsync(page);
  figma.currentPage.selection = [node];
  figma.viewport.scrollAndZoomIntoView([node]);
  return {};
}

// ---------- messages ----------

const handlers = {
  exportSelection,
  place,
  show,
  async saveSettings({ settings }) { await figma.clientStorage.setAsync(SETTINGS_KEY, settings); return {}; },
  openURL({ url }) { figma.openExternal(url); return {}; },
  notify({ text, error }) { figma.notify(text, { error: !!error }); return {}; },
  selection() { return selectionInfo(); },
};

figma.ui.onmessage = async (msg) => {
  const fn = handlers[msg && msg.type];
  if (!fn) return;
  try {
    const out = await fn(msg);
    figma.ui.postMessage(Object.assign({ type: 'reply', id: msg.id, ok: true }, out));
  } catch (e) {
    figma.ui.postMessage({ type: 'reply', id: msg.id, ok: false, error: (e && e.message) || String(e) });
  }
};

(async () => {
  const settings = (await figma.clientStorage.getAsync(SETTINGS_KEY)) || {};
  figma.ui.postMessage({ type: 'init', settings, selection: selectionInfo() });
})();
