# Vector Iris for Figma

The Figma version of Vector Iris: the same Trace, Redraw and Generate modes,
the same Quiver client, placed as editable vector layers on the Figma canvas.
**Status: preview (0.1.0), run as a development plugin.** Working in Figma
desktop; a Figma Community listing is in progress.

## Try it

1. Open the **Figma desktop app** (development plugins don't load in the browser).
2. **Plugins › Development › Import plugin from manifest…** and pick
   `figma/manifest.json` from this folder.
3. Run it from **Plugins › Development › Vector Iris**. Paste your Quiver key
   on the welcome screen; it is checked with Quiver before it's saved.

Select a layer (an image, a frame, anything visible) and press **Vectorize**:
the result lands beside it at the same size. In Generate with nothing
selected, it lands in the middle of your view.

## How it differs from the Illustrator panel

| | Illustrator | Figma |
|---|---|---|
| Talks to Quiver | Node `https` in the panel | Browser `fetch` in the plugin UI (Quiver allows cross-origin calls) |
| Key stored in | a settings file in AppData / Application Support | `figma.clientStorage` (local to this computer) |
| Export | temp document + scaling trick + mask measuring | `exportAsync`, which already respects masks and clipping |
| Place | SVG import + injected `vi-frame` clip rect | `createNodeFromSvg`, a frame that clips to the viewBox |
| SVG files on disk | saved automatically to `Documents/Vector Iris` | Figma plugins can't write files: each result has an **SVG** download link for the session, and **Show** finds the layer any time |

## Files

| File | Role |
|---|---|
| `manifest.json` | Registers the plugin; allows network access to `api.quiver.ai` only |
| `code.js` | Main thread: selection, export, placing, settings storage |
| `src/ui.html`, `src/ui.js`, `src/figma.css` | The plugin UI (ported from `index.html` / `js/panel.js`) |
| `ui.html` | **Built file.** Figma loads the UI as one HTML string, so `build.js` inlines `../css/panel.css`, `../js/quiver.js` and `src/` into it |
| `build.js` | `node build.js` after editing `src/`, `css/panel.css` or `js/quiver.js` |

`js/quiver.js` is shared with the Illustrator panel: a Quiver fix lands in
both. It uses Node `https` when `require` exists and `fetch` otherwise.

## Known gaps before release

- **Long runs.** The Illustrator panel sets TCP keepalive to stop routers
  dropping silent connections after about 35 s (Telos, high effort). A browser
  can't do that. If long runs fail with a network error in Figma, the fix is
  switching to Quiver's streaming responses.
- Community listing: copy, icon and cover are ready in `listing/`; the real plugin id comes from Figma at publish time.
