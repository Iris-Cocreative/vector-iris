# Vector Iris

**Clean, editable vectors from images and ideas, inside Adobe Illustrator.**
A free panel from [Iris Cocreative](https://www.iriscocreative.com/), powered by
[Quiver](https://quiver.ai/)'s Arrow models. Bring your own Quiver API key.

Select an image and Vector Iris returns real Illustrator paths beside it, at
the same size: continuous curves and the right number of shapes, not the
speckled fragments of a classic trace. Or describe something and it draws it.

## Three modes

| Mode | What it does | Best for |
|---|---|---|
| **Trace** | Follows the pixels closely, gradients included | Logos, scans, flat illustration, UI art |
| **Redraw** | Rebuilds the image from flat shapes, guided by a prompt | Photos, people, anything you want simplified |
| **Generate** | Creates new artwork from a description, optionally matching the style of your selection | Icons, marks, spot illustrations |

Every result is also saved as an `.svg` file (default: `Documents/Vector Iris`).

## Requirements

- Adobe Illustrator 2021 (v25) or later
- Windows or macOS (macOS support is new; please [report issues](https://github.com/Iris-Cocreative/vector-iris/issues))
- A [Quiver API account](https://platform.quiver.ai/) with credit (prepaid, from $10)

## Install

Download this repository (**Code › Download ZIP**, then unzip) or clone it.

**Windows:** double-click **`install.cmd`**.

**macOS:** open Terminal, type `bash ` (with a space), drag **`install.sh`**
into the window, and press Return.

Then quit Illustrator completely, reopen it, and choose
**Window › Extensions › Vector Iris**. Paste your Quiver API key when asked;
Vector Iris checks it with Quiver before saving.

The installer copies the panel into Adobe's extensions folder and turns on
Adobe's `PlayerDebugMode` setting, which Illustrator requires for panels
installed outside Adobe's marketplace. To remove it, run `uninstall.cmd` or
`uninstall.sh`; add `-ResetDebug` (Windows) or `--reset-debug` (macOS) to also
turn that setting back off.

## Cost

Quiver bills your account per result, by tokens. Vector Iris shows the
estimated cost of every run. As a guide, from our testing on Arrow 2:

| Job | Time | Cost |
|---|---|---|
| Simple icon or logo, low effort | 10 to 35 s | about 3¢ |
| Flat graphic or pattern, low effort | 30 to 75 s | 9 to 22¢ |
| Photo, high effort | 3 to 4 min | 40 to 55¢ |

Arrow 2 Telos costs about 50% more. The size of the image you send barely
matters; what costs money is how much comes back. Crop with a clipping mask
first and only the visible area is sent.

## Choosing settings

**Start with Arrow 2 Telos on Low effort.** That's the default, and in our
tests it gave the best results on flat graphics.

**Effort** is how long Arrow reasons before it draws, not how detailed the
result is. In a side-by-side test on the same image, Medium billed 2.3 times
the tokens of Low: about 40% of them were reasoning you never see, and the
rest went into splitting the image into more shapes (28 instead of 18). On
clean graphics, more pieces mean more seams and slivers, so higher effort can
look worse. The better model at low effort usually wins over the faster model
at high effort. Raise effort only when a result misses structure.

Some images are hard for any vectorizer: many overlapping bands that weave
over and under each other, for example. Expect those to need cleanup.

## Privacy

- Your API key is stored only on your computer, in
  `%APPDATA%\IrisCocreative\VectorIris\settings.json` (Windows) or
  `~/Library/Application Support/IrisCocreative/VectorIris/settings.json`
  (macOS), and is sent only to Quiver.
- The images you vectorize and the prompts you write are sent to Quiver's API
  for processing. Nothing is sent to Iris Cocreative, and the panel has no
  analytics.

## Rights

Quiver's [terms](https://quiver.ai/legal/terms/) assign you the rights to what
you generate, and limit output made on their free tier to non-commercial use.
Check them for your plan. You are responsible for having the rights to images
you vectorize.

## How it works

```
selection ─► export PNG (mask-aware, scaled to 1–4k px) ─► Quiver API ─► SVG
                                                                         │
Illustrator ◄── import as editable group, clipped to the SVG's frame ◄───┘
```

| File | Role |
|---|---|
| `CSXS/manifest.xml` | Registers the CEP panel with Illustrator; enables Node.js in the panel |
| `js/panel.js` | UI, onboarding, settings, the export → request → place flow |
| `js/quiver.js` | Quiver API client over Node `https`; also runs in plain Node for testing |
| `jsx/host.jsx` | ExtendScript inside Illustrator: read the selection, export it, place the result |

Some details that took testing to get right:

- **Clipping masks.** Illustrator's scripting reports a clipped group's size as
  its whole hidden contents. Vector Iris measures the mask instead, so a cropped
  image exports (and costs) only what you see.
- **Export resolution.** The selection is copied into a temporary document and
  scaled so 1 pt = 1 pixel at the target size, which gets around the PNG
  exporter's scale limit for small artwork.
- **Square in, cropped out.** Arrow reads images as if they were square: a
  1024 x 801 canvas came back with the trace squeezed into a centered 801 x 626
  box, and Redraw proportions drifted on wide or tall photos. Trace and Redraw
  now pad the image to a square (never stretched), ask for a square canvas, and
  crop the SVG's viewBox back to the image. Generate is unaffected: it fills
  wide and tall canvases correctly.
- **Slow runs stay connected.** Quiver sends nothing until the SVG is done, and
  Telos or high-effort runs can sit silent for minutes; TCP keepalive stops the
  network from dropping the idle connection.
- **The SVG's frame.** Illustrator's SVG import ignores the viewBox and keeps
  shapes drawn past the edge. Vector Iris adds an invisible frame before
  importing, uses it to size and align the result, and turns it into a
  clipping mask so the art matches what a browser shows.

**Developing:** run `install.ps1 -Link` (Windows) or `./install.sh --link`
(macOS) to link this folder instead of copying it, then close and reopen the
panel to pick up changes. Chrome DevTools for
the panel: `http://localhost:8089` (see `.debug`).

## Known limits

- Illustrator renders SVG blur filters much more weakly than browsers do, so
  soft photo backgrounds from Trace come in as sharper shapes.
- Canceling stops waiting, but Quiver may still bill for work it already did.
- The selection summary updates when your pointer moves back over the panel.

## License

Copyright 2026 Iris Cocreative, LLC.
Code: [Apache License 2.0](LICENSE). The Vector Iris name and mark are not
included in that license; see [TRADEMARKS.md](TRADEMARKS.md).

Vector Iris is independent and not affiliated with QuiverAI or Adobe.
