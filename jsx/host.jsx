// Vector Iris: the Illustrator side of the panel.
// ExtendScript (ES3): no let/const, no arrow functions, no native JSON.
//
//   VI.selectionInfo()        what's selected, for the panel's status line
//   VI.exportSelection(opts)  rasterize the selection to a PNG at a target size
//   VI.place(opts)            import an SVG as editable art beside the source or mid-view

var VI = (function () {
    var FRAME = "vi-frame"; // invisible viewBox rect the panel injects into every SVG

    // ---- tiny JSON writer ----
    function str(s) {
        return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n") + '"';
    }
    function toJSON(v) {
        if (v === null || v === undefined) return "null";
        if (typeof v === "number") return isFinite(v) ? String(v) : "null";
        if (typeof v === "boolean") return v ? "true" : "false";
        if (typeof v === "string") return str(v);
        var out = [], k, i;
        if (v instanceof Array) {
            for (i = 0; i < v.length; i++) out.push(toJSON(v[i]));
            return "[" + out.join(",") + "]";
        }
        for (k in v) if (v.hasOwnProperty(k)) out.push(str(k) + ":" + toJSON(v[k]));
        return "{" + out.join(",") + "}";
    }
    function ok(data) { data = data || {}; data.ok = true; return toJSON(data); }
    function fail(msg) { return toJSON({ ok: false, error: msg }); }

    function withDocCoords(fn) {
        var prev = app.coordinateSystem;
        app.coordinateSystem = CoordinateSystem.DOCUMENTCOORDINATESYSTEM;
        try { return fn(); }
        catch (e) { return fail(e.message || String(e)); }
        finally { app.coordinateSystem = prev; }
    }

    function selected(d) {
        var sel = d.selection, out = [], i, it;
        if (!sel || sel.length === undefined || sel.typename) return out;
        for (i = 0; i < sel.length; i++) {
            it = sel[i];
            if (!it || !it.typename || it.typename === "TextRange") continue;
            if (it.parent && it.parent.typename === "CompoundPathItem") it = it.parent;
            out.push(it);
        }
        return out;
    }

    // ---- bounds that respect clipping masks ----
    // Scripting reports a clipped group's bounds as the size of everything
    // inside it, masked or not. These functions measure what is actually visible.

    function union(a, b) {
        if (!a) return b ? [b[0], b[1], b[2], b[3]] : null;
        if (!b) return a;
        return [Math.min(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2]), Math.min(a[3], b[3])];
    }
    function intersect(a, b) {
        var r = [Math.max(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[3], b[3])];
        return (r[2] > r[0] && r[1] > r[3]) ? r : a;
    }
    function clipPathOf(g) {
        for (var i = 0; i < g.pageItems.length; i++) {
            var c = g.pageItems[i];
            if (c.typename === "PathItem" && c.clipping) return c;
            if (c.typename === "CompoundPathItem" && c.pathItems.length && c.pathItems[0].clipping) return c;
        }
        return null;
    }
    function visualBounds(it) {
        if (it.typename !== "GroupItem") return it.visibleBounds;
        var clip = it.clipped ? clipPathOf(it) : null, inner = null, i, c;
        for (i = 0; i < it.pageItems.length; i++) {
            c = it.pageItems[i];
            if (c === clip || c.hidden) continue;
            inner = union(inner, visualBounds(c));
        }
        if (clip) return inner ? intersect(clip.geometricBounds, inner) : clip.geometricBounds;
        return inner || it.visibleBounds;
    }
    function unionBounds(items) {
        var b = null;
        for (var i = 0; i < items.length; i++) b = union(b, visualBounds(items[i]));
        return b;
    }

    function isImage(it) { return it.typename === "PlacedItem" || it.typename === "RasterItem"; }

    // An image inside a clipping group still counts as an image.
    function containsImage(it) {
        if (isImage(it)) return true;
        if (it.typename === "GroupItem") {
            for (var i = 0; i < it.pageItems.length; i++) if (containsImage(it.pageItems[i])) return true;
        }
        return false;
    }

    function labelFor(items) {
        if (items.length !== 1) return items.length + " objects";
        var it = items[0];
        if (it.name) return it.name;
        try {
            var img = it;
            if (it.typename === "GroupItem") for (var i = 0; i < it.pageItems.length; i++) if (isImage(it.pageItems[i])) img = it.pageItems[i];
            if (img.typename === "PlacedItem" && img.file) return decodeURI(img.file.name).replace(/\.[^.]+$/, "");
        } catch (e) {}
        return containsImage(it) ? "image" : "artwork";
    }

    function findDoc(name) {
        for (var i = 0; i < app.documents.length; i++) if (app.documents[i].name === name) return app.documents[i];
        return null;
    }

    function findByName(container, name) {
        var items = container.pageItems, i, it, hit;
        for (i = 0; i < items.length; i++) {
            it = items[i];
            if (it.name === name) return it;
            if (it.typename === "GroupItem") { hit = findByName(it, name); if (hit) return hit; }
        }
        return null;
    }

    // ---- public ----

    function selectionInfo() {
        if (!app.documents.length) return ok({ doc: false, count: 0 });
        var d = app.activeDocument, items = selected(d), images = 0;
        for (var i = 0; i < items.length; i++) if (containsImage(items[i])) images++;
        return ok({ doc: true, docName: d.name, count: items.length, images: images, label: items.length ? labelFor(items) : "" });
    }

    // opts: { maxPx, outBase }  (outBase = path without extension, forward slashes)
    function exportSelection(o) {
        if (!app.documents.length) return fail("Open a document first.");
        var d = app.activeDocument;
        var items = selected(d);
        if (!items.length) return fail("Select an image (or any artwork) first.");
        var maxPx = Math.max(128, Math.min(4096, Number(o.maxPx) || 2048));

        return withDocCoords(function () {
            var b = unionBounds(items);
            var wPt = b[2] - b[0], hPt = b[1] - b[3];
            if (wPt < 0.5 || hPt < 0.5) return fail("The selection has no visible size.");
            var label = labelFor(items);

            // Front-most first, so PLACEATEND rebuilds the stacking order.
            items.sort(function (a, c) {
                try { return c.absoluteZOrderPosition - a.absoluteZOrderPosition; } catch (e) { return 0; }
            });

            var tmp = app.documents.add(DocumentColorSpace.RGB, Math.ceil(wPt), Math.ceil(hPt));
            var file = null, format = "png", pxW = 0, pxH = 0;
            try {
                // Cross-document duplicate only accepts a layer as target; group afterward.
                var layer = tmp.layers[0], copies = [];
                for (var i = 0; i < items.length; i++) copies.push(items[i].duplicate(layer, ElementPlacement.PLACEATEND));
                var g = layer.groupItems.add();
                for (i = 0; i < copies.length; i++) copies[i].move(g, ElementPlacement.PLACEATEND);

                // Scale the art itself so 1 pt = 1 output pixel at the target size;
                // PNG export's own scale option tops out far below 4096 px for small art.
                var s = maxPx / Math.max(wPt, hPt);
                g.resize(s * 100, s * 100, true, true, true, true, s * 100, Transformation.TOPLEFT);
                var gb = visualBounds(g); // the mask's area, not the whole hidden image
                pxW = Math.max(1, Math.round(gb[2] - gb[0]));
                pxH = Math.max(1, Math.round(gb[1] - gb[3]));
                tmp.artboards[0].artboardRect = [gb[0], gb[1], gb[0] + pxW, gb[1] - pxH];

                Folder(File(o.outBase + ".png").path).create();
                var png = new ExportOptionsPNG24();
                png.artBoardClipping = true;
                png.antiAliasing = true;
                png.transparency = true;
                png.horizontalScale = 100;
                png.verticalScale = 100;
                file = new File(o.outBase + ".png");
                tmp.exportFile(file, ExportType.PNG24, png);

                // Quiver takes up to 12 MiB. Busy photos at 4096 px can exceed that as PNG.
                if (file.length > 11.5 * 1024 * 1024) {
                    file.remove();
                    var jpg = new ExportOptionsJPEG();
                    jpg.artBoardClipping = true;
                    jpg.antiAliasing = true;
                    jpg.qualitySetting = 90;
                    jpg.horizontalScale = 100;
                    jpg.verticalScale = 100;
                    file = new File(o.outBase + ".jpg");
                    tmp.exportFile(file, ExportType.JPEG, jpg);
                    format = "jpg";
                }
            } finally {
                tmp.close(SaveOptions.DONOTSAVECHANGES);
                d.activate();
            }
            if (!file || !file.exists) return fail("Illustrator could not export the selection.");
            return ok({
                file: file.fsName, format: format, width: pxW, height: pxH, bytes: file.length,
                docName: d.name, bounds: b, label: label
            });
        });
    }

    // opts: { svgPath, name, target: "beside" | "view", docName?, bounds?, gap?, viewFraction? }
    //   beside: scale to fit `bounds` and sit `gap` pt to its right (in document docName)
    //   view:   long side = viewFraction of the visible area, centered in the active view
    function place(o) {
        var d = o.docName ? findDoc(o.docName) : (app.documents.length ? app.activeDocument : null);
        if (!d) return fail(o.docName ? 'The document "' + o.docName + '" is no longer open. The SVG was saved to disk.' : "Open a document first.");
        d.activate();
        return withDocCoords(function () {
            var f = new File(o.svgPath);
            if (!f.exists) return fail("SVG file not found: " + o.svgPath);
            if (d.activeLayer.locked || !d.activeLayer.visible) return fail("The active layer is locked or hidden. Unlock it and try again. The SVG was saved to disk.");

            var g = d.groupItems.createFromFile(f);

            // The frame is the reference for size and position (Quiver sometimes
            // draws past the edge), then becomes a clipping mask so the art
            // matches what a browser shows.
            var frame = findByName(g, FRAME);
            if (frame) {
                frame.move(g, ElementPlacement.PLACEATBEGINNING);
                g.clipped = true;
            }
            var ref = frame || g;
            var vb = ref.geometricBounds;
            var w = vb[2] - vb[0], h = vb[1] - vb[3], s, left, top;

            if (o.target === "view") {
                var v = d.activeView.bounds; // visible area, document coordinates
                var vw = v[2] - v[0], vh = v[1] - v[3];
                var box = Math.min(vw, vh) * (Number(o.viewFraction) || 0.5);
                s = box / Math.max(w, h);
                left = (v[0] + v[2]) / 2 - w * s / 2;
                top = (v[1] + v[3]) / 2 + h * s / 2;
            } else {
                var src = o.bounds;
                s = Math.min((src[2] - src[0]) / w, (src[1] - src[3]) / h);
                left = src[2] + (Number(o.gap) || 0);
                top = src[1];
            }
            if (w > 0 && h > 0) g.resize(s * 100, s * 100, true, true, true, true, s * 100, Transformation.TOPLEFT);
            vb = ref.geometricBounds;
            g.translate(left - vb[0], top - vb[1]);
            g.name = o.name || "Vector Iris";
            d.selection = null;
            g.selected = true;
            return ok({ name: g.name });
        });
    }

    return { selectionInfo: selectionInfo, exportSelection: exportSelection, place: place };
})();
