/*
 * ExportFrameDimensions.jsx  v2 — Frame measurer + guide reader
 * ==============================================================
 *
 * PURPOSE
 *   Run ONCE on any InDesign template before face_offset_calculator.py.
 *   Extracts everything Python needs to position faces correctly for THIS
 *   specific template — frame sizes AND the red guide positions that define
 *   where faces should land.
 *
 * WHAT IT MEASURES
 *   1. Student portrait frame  W × H (mm)
 *   2. Teacher portrait frame  W × H (mm)
 *   3. The two horizontal red guides (顔位置ガイド layer) that bracket the
 *      face zone, expressed as ratios of the student frame height:
 *        guide_top_ratio   → becomes target_forehead_y  (top of face zone)
 *        guide_bottom_ratio → becomes target_chin_y     (where chin should land)
 *   4. A scale clamp range derived from the frame aspect ratio, so faces
 *      are never over- or under-zoomed for this layout's photo crop style.
 *
 * HOW THE GUIDE RATIOS WORK
 *   The red guides are horizontal lines on the 顔位置ガイド layer.
 *   For each student frame, we find which guides overlap it and compute:
 *     guide_top_ratio    = (guide_y - frame_top) / frame_height
 *     guide_bottom_ratio = (guide_y - frame_top) / frame_height
 *   Python uses guide_bottom_ratio as target_chin_y directly.
 *   The face height (forehead→chin) as a fraction of frame height becomes
 *   the basis for the scale clamp range.
 *
 * USAGE
 *   1. Open your InDesign template
 *   2. Edit CONFIG.outputFile below
 *   3. Run via Scripts panel
 *   4. Run face_offset_calculator.py — it reads frame_config.json automatically
 *
 * OUTPUT  frame_config.json  (place next to manifest.json)
 */

#target indesign

// ══════════════════════════════════════════════════════════════════
// CONFIGURATION
// ══════════════════════════════════════════════════════════════════

var CONFIG = {
    // ← Edit this to your project folder (same folder as manifest.json)
    outputFile: "D:\\career\\1_LTID\\Photography\\output_千早高_FINAL_v6\\frame_config.json",

    // Layer names — must match AutoPlacePhotos CONFIG.layers
    portraitLayer:    "Default",
    portraitLayerAlt: "本番カット",
    guideLayer:       "顔位置ガイド",   // layer that holds the two red face-zone guides

    // Which spread to measure (−1 = active spread)
    spreadIndex: -1,

    // How much tolerance (mm) when deciding two guide lines are "near" a frame
    guideTolerance: 5
};


// ══════════════════════════════════════════════════════════════════
// UNIT HELPER — switch doc to mm, read, restore
// ══════════════════════════════════════════════════════════════════

function withMM(doc, fn) {
    var origH = null, origV = null;
    try {
        origH = doc.viewPreferences.horizontalMeasurementUnits;
        origV = doc.viewPreferences.verticalMeasurementUnits;
        doc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.MILLIMETERS;
        doc.viewPreferences.verticalMeasurementUnits   = MeasurementUnits.MILLIMETERS;
    } catch(e) {}
    var result = fn();
    try {
        if (origH !== null) doc.viewPreferences.horizontalMeasurementUnits = origH;
        if (origV !== null) doc.viewPreferences.verticalMeasurementUnits   = origV;
    } catch(e) {}
    return result;
}

function getDocObj(item) {
    var d = item;
    while (d && d.constructor.name !== "Document") {
        try { d = d.parent; } catch(e) { return null; }
    }
    return d;
}


// ══════════════════════════════════════════════════════════════════
// FRAME HELPERS
// ══════════════════════════════════════════════════════════════════

function getAllPageItems(container) {
    var items = [];
    var top = container.allPageItems;
    for (var i = 0; i < top.length; i++) { items.push(top[i]); }
    return items;
}

function getFramesOnLayer(spread, layerName, altLayerName) {
    var frames = [];
    var allItems = getAllPageItems(spread);
    for (var i = 0; i < allItems.length; i++) {
        var item = allItems[i];
        if (item.constructor.name !== "Rectangle") continue;
        try {
            var lName = item.itemLayer.name;
            if (lName === layerName || (altLayerName && lName === altLayerName)) {
                frames.push(item);
            }
        } catch (e) {}
    }
    return frames;
}

function findLargestFrame(frames) {
    var maxArea = 0, idx = -1;
    for (var i = 0; i < frames.length; i++) {
        var gb = frames[i].geometricBounds;
        var area = (gb[3] - gb[1]) * (gb[2] - gb[0]);
        if (area > maxArea) { maxArea = area; idx = i; }
    }
    return idx;
}

function frameBoundsMM(frame, doc) {
    return withMM(doc, function() {
        var gb = frame.geometricBounds; // [top, left, bottom, right]
        return {
            top:    gb[0], left:  gb[1],
            bottom: gb[2], right: gb[3],
            w: Math.abs(gb[3] - gb[1]),
            h: Math.abs(gb[2] - gb[0])
        };
    });
}


// ══════════════════════════════════════════════════════════════════
// GUIDE READER
// Reads horizontal guide lines on a specific layer (as rectangles
// used as visual guides), OR InDesign ruler guides, OR thin
// rectangles — handles all three conventions designers use.
// ══════════════════════════════════════════════════════════════════

function getGuideYPositionsMM(spread, doc, guideLayerName, tolerance, forTeacher) {
    /*
     * Strategy A: Look for very thin rectangles on the guide layer
     *   (common: designers draw a 0.25pt hairline rectangle as a guide)
     * Strategy B: Look for InDesign ruler guides (doc.guides)
     * Returns array of Y positions in mm, sorted top→bottom.
     */
    var yPositions = [];

    // ── Strategy A: thin rectangles on the guide layer ──────────
    var allItems = getAllPageItems(spread);
    for (var i = 0; i < allItems.length; i++) {
        var item = allItems[i];
        if (item.constructor.name !== "Rectangle" &&
            item.constructor.name !== "GraphicLine") continue;
        try {
            if (item.itemLayer.name !== guideLayerName) continue;
        } catch(e) { continue; }

        // Check if item is inside a group
        var isGrouped = (item.parent && 
                         item.parent.constructor.name === "Group");

        // Teacher guides = top-level lines (not in a group)
        // Student guides = lines inside a group
        if (forTeacher && isGrouped) continue;
        if (!forTeacher && !isGrouped) continue;

        var b = withMM(doc, function() { return item.geometricBounds; });
        var itemH = Math.abs(b[2] - b[0]);
        var centerY = (b[0] + b[2]) / 2;

        if (itemH < 3 || item.constructor.name === "GraphicLine") {
            yPositions.push(Math.round(centerY * 100) / 100);
        }
        // Also accept wide, nearly-zero-height rectangles used as rules
        else if (itemH < 1.5 && itemW > 10) {
            yPositions.push(Math.round(centerY * 100) / 100);
        }
    }

    // ── Strategy B: InDesign ruler guides ────────────────────────
    // (Ruler guides aren't on layers — check all guides on the spread)
    try {
        var guides = spread.guides;
        for (var g = 0; g < guides.length; g++) {
            try {
                if (guides[g].orientation === HorizontalOrVertical.HORIZONTAL) {
                    var gy = withMM(doc, function() { return guides[g].location; });
                    yPositions.push(Math.round(gy * 100) / 100);
                }
            } catch(e) {}
        }
    } catch(e) {}

    // ── Deduplicate positions within tolerance ───────────────────
    yPositions.sort(function(a, b) { return a - b; });
    var deduped = [];
    for (var j = 0; j < yPositions.length; j++) {
        if (deduped.length === 0 ||
            Math.abs(yPositions[j] - deduped[deduped.length - 1]) > tolerance) {
            deduped.push(yPositions[j]);
        }
    }

    $.writeln("  Guide Y positions found (mm): [" + deduped.join(", ") + "]");
    return deduped;
}


function computeGuideRatiosForFrame(frameBounds, allGuideYs, tolerance) {
    var frameTop    = frameBounds.top;
    var frameBottom = frameBounds.bottom;
    var frameH      = frameBounds.h;

    var inside = [];
    for (var i = 0; i < allGuideYs.length; i++) {
        var gy = allGuideYs[i];
        // STRICT: guide must be genuinely inside the frame, not just near it
        if (gy > frameTop && gy < frameBottom) {
            inside.push(gy);
        }
    }

    if (inside.length < 2) return null;

    inside.sort(function(a, b) { return a - b; });
    var topGuide    = inside[0];
    var bottomGuide = inside[inside.length - 1];

    return {
        top_ratio:    Math.round(((topGuide    - frameTop) / frameH) * 1000) / 1000,
        bottom_ratio: Math.round(((bottomGuide - frameTop) / frameH) * 1000) / 1000
    };
}


function getGuideYFromLayer(spread, doc, layerName, groupOnly) {
    var yPositions = [];
    var allItems = getAllPageItems(spread);
    for (var i = 0; i < allItems.length; i++) {
        var item = allItems[i];
        if (item.constructor.name !== "Rectangle" &&
            item.constructor.name !== "GraphicLine") continue;
        try {
            if (item.itemLayer.name !== layerName) continue;
        } catch(e) { continue; }

        // groupOnly = true  → only items inside a group (student guides)
        // groupOnly = false → only top-level items OR first group's children
        var isGrouped = (item.parent && item.parent.constructor.name === "Group");
        if (groupOnly !== undefined && groupOnly !== isGrouped) continue;

        var b = withMM(doc, function() { return item.geometricBounds; });
        var itemH = Math.abs(b[2] - b[0]);
        if (itemH < 3 || item.constructor.name === "GraphicLine") {
            yPositions.push(Math.round(((b[0] + b[2]) / 2) * 100) / 100);
        }
    }
    yPositions.sort(function(a, b) { return a - b; });
    return yPositions;
}

// ══════════════════════════════════════════════════════════════════
// SCALE CLAMP CALCULATOR
// Derives a sensible min/max scale clamp from frame aspect ratio.
// Portrait frames that are taller relative to width need higher zoom
// to fill the face zone properly.
// ══════════════════════════════════════════════════════════════════

function deriveScaleClamp(frameW, frameH, guideRatios) {
    /*
     * The face zone height = (bottom_ratio - top_ratio) * frameH.
     * We want that zone to be filled by a face that occupies roughly
     * 70–85% of the full image height (typical portrait crop).
     * Scale = frameH_in_image_space / actual_face_zone_mm  → expressed as %.
     *
     * We return a [min, max] clamp.  The actual per-person scale is computed
     * from eye distance in compute_offsets(); this clamp just prevents
     * runaway values from bad detections.
     */
    var faceZoneH = (guideRatios.bottom_ratio - guideRatios.top_ratio) * frameH;
    var aspectRatio = frameW / frameH;

    // Empirically: taller frames (small aspect ratio) need more zoom
    // Base range: 125–145 for standard 36×44mm (aspect ~0.82)
    // Adjust linearly with aspect ratio deviation from 0.82 baseline
    var baseMin = 125, baseMax = 145;
    var aspectDelta = (0.82 - aspectRatio) * 30;   // ~30% shift per unit aspect change
    var clampMin = Math.round(baseMin + aspectDelta);
    var clampMax = Math.round(baseMax + aspectDelta);

    // Hard safety bounds
    clampMin = Math.max(110, Math.min(clampMin, 150));
    clampMax = Math.max(clampMin + 10, Math.min(clampMax, 175));

    return { min: clampMin, max: clampMax };
}


// ══════════════════════════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════════════════════════

function zeroPad(n, w) {
    var s = String(n);
    while (s.length < w) s = "0" + s;
    return s;
}

function isoTimestamp() {
    var d = new Date();
    return d.getFullYear() + "-" +
           zeroPad(d.getMonth() + 1, 2) + "-" +
           zeroPad(d.getDate(), 2) + "T" +
           zeroPad(d.getHours(), 2) + ":" +
           zeroPad(d.getMinutes(), 2) + ":" +
           zeroPad(d.getSeconds(), 2);
}

function writeTextFile(path, content) {
    var f = new File(path);
    f.encoding = "UTF-8";
    f.open("w");
    f.write(content);
    f.close();
}

function r(n, dec) {
    var factor = Math.pow(10, dec || 3);
    return Math.round(n * factor) / factor;
}


// ══════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════

(function main() {

    $.writeln("╔══════════════════════════════════════════════╗");
    $.writeln("║  ExportFrameDimensions v2 — Full Measurer    ║");
    $.writeln("╚══════════════════════════════════════════════╝");

    // ── Document ──────────────────────────────────────────────────
    if (app.documents.length === 0) {
        alert("No document is open. Please open your InDesign template first.");
        return;
    }
    var doc = app.activeDocument;
    $.writeln("✓ Document: " + doc.name);

    // ── Spread ────────────────────────────────────────────────────
    var spread;
    if (CONFIG.spreadIndex >= 0) {
        spread = doc.spreads[CONFIG.spreadIndex];
    } else {
        spread = app.layoutWindows[0].activePage.parent;
    }
    $.writeln("✓ Spread: pages " +
        spread.pages[0].name + "–" + spread.pages[spread.pages.length - 1].name);

    // ── Portrait frames ───────────────────────────────────────────
    var allPortraitFrames = getFramesOnLayer(
        spread, CONFIG.portraitLayer, CONFIG.portraitLayerAlt
    );
    $.writeln("  Portrait frames found: " + allPortraitFrames.length);

    if (allPortraitFrames.length < 2) {
        alert("ERROR: Need at least 2 portrait frames.\nFound: " + allPortraitFrames.length +
              "\nCheck CONFIG.portraitLayer (" + CONFIG.portraitLayer + ")");
        return;
    }

    // Remove group photo (largest)
    var groupIdx = findLargestFrame(allPortraitFrames);
    if (groupIdx >= 0) {
        var gd = frameBoundsMM(allPortraitFrames[groupIdx], doc);
        $.writeln("  Group frame removed: " + r(gd.w,1) + " × " + r(gd.h,1) + " mm");
        allPortraitFrames.splice(groupIdx, 1);
    }

    // Teacher frame (largest remaining)
    var teacherIdx = findLargestFrame(allPortraitFrames);
    var teacherBounds = frameBoundsMM(allPortraitFrames[teacherIdx], doc);
    $.writeln("  Teacher frame: " + r(teacherBounds.w,2) + " × " + r(teacherBounds.h,2) + " mm");
    var teacherFrameRef = allPortraitFrames[teacherIdx];
    allPortraitFrames.splice(teacherIdx, 1);

    // Student frame (most common size)
    var sizeMap = {};
    var sizeFrameMap = {};  // key → first frame with that size (for guide sampling)
    for (var i = 0; i < allPortraitFrames.length; i++) {
        var d = frameBoundsMM(allPortraitFrames[i], doc);
        var key = r(d.w,2) + "x" + r(d.h,2);
        sizeMap[key] = (sizeMap[key] || 0) + 1;
        if (!sizeFrameMap[key]) sizeFrameMap[key] = { frame: allPortraitFrames[i], bounds: d };
    }
    var bestKey = null, bestCount = 0;
    for (var k in sizeMap) {
        if (sizeMap.hasOwnProperty(k) && sizeMap[k] > bestCount) {
            bestCount = sizeMap[k]; bestKey = k;
        }
    }
    var studentW = parseFloat(bestKey.split("x")[0]);
    var studentH = parseFloat(bestKey.split("x")[1]);
    var representativeStudentBounds = sizeFrameMap[bestKey].bounds;
    $.writeln("  Student frame: " + studentW + " × " + studentH +
              " mm  (" + bestCount + " frames)");

    // ── Read guide positions ──────────────────────────────────────
    $.writeln("\n  Reading guide positions on layer '" + CONFIG.guideLayer + "'...");
    var allGuideYs = getGuideYPositionsMM(
        spread, doc, CONFIG.guideLayer, CONFIG.guideTolerance
    );

    // Compute guide ratios relative to a representative student frame
    // var studentGuideRatios = null;
    // if (allGuideYs.length >= 2) {
    //     studentGuideRatios = computeGuideRatiosForFrame(
    //         representativeStudentBounds, allGuideYs, CONFIG.guideTolerance
    //     );
    // }

    // // Compute guide ratios relative to teacher frame
    // var teacherGuideRatios = null;
    // if (allGuideYs.length >= 2) {
    //     teacherGuideRatios = computeGuideRatiosForFrame(
    //         teacherBounds, allGuideYs, CONFIG.guideTolerance
    //     );
    // }

    // Student guides: 顔位置ガイド layer, inside group
    var studentGuideYs = getGuideYFromLayer(
        spread, doc, CONFIG.guideLayer, true  // grouped items only
    );

    // Teacher guides: Default layer, inside first group
    var teacherGuideYs = getGuideYFromLayer(
        spread, doc, CONFIG.portraitLayer, true  // grouped items in Default layer
    );

    $.writeln("  Student guide Ys: [" + studentGuideYs.join(", ") + "]");
    $.writeln("  Teacher guide Ys: [" + teacherGuideYs.join(", ") + "]");

    // Use strict matching (tolerance = 0)
    var studentGuideRatios = studentGuideYs.length >= 2
        ? computeGuideRatiosForFrame(representativeStudentBounds, studentGuideYs, 0)
        : null;

    var teacherGuideRatios = teacherGuideYs.length >= 2
        ? computeGuideRatiosForFrame(teacherBounds, teacherGuideYs, 0)
        : null;

    // ── Derive scale clamps ───────────────────────────────────────
    var studentClamp, teacherClamp;
    if (studentGuideRatios) {
        studentClamp = deriveScaleClamp(studentW, studentH, studentGuideRatios);
        $.writeln("  Student guides: top=" + studentGuideRatios.top_ratio +
                  "  bottom=" + studentGuideRatios.bottom_ratio +
                  "  → scale clamp [" + studentClamp.min + "–" + studentClamp.max + "%]");
    } else {
        studentClamp = { min: 125, max: 145 };
        $.writeln("  ⚠ Could not compute student guide ratios — using defaults");
    }
    if (teacherGuideRatios) {
        teacherClamp = deriveScaleClamp(teacherBounds.w, teacherBounds.h, teacherGuideRatios);
        $.writeln("  Teacher guides: top=" + teacherGuideRatios.top_ratio +
                  "  bottom=" + teacherGuideRatios.bottom_ratio +
                  "  → scale clamp [" + teacherClamp.min + "–" + teacherClamp.max + "%]");
    } else {
        teacherClamp = { min: 120, max: 145 };
        $.writeln("  ⚠ Could not compute teacher guide ratios — using defaults");
    }

    // ── Build JSON ────────────────────────────────────────────────
    var sizeMapStr = "{";
    var first = true;
    for (var sk in sizeMap) {
        if (!sizeMap.hasOwnProperty(sk)) continue;
        if (!first) sizeMapStr += ", ";
        sizeMapStr += '"' + sk + '": ' + sizeMap[sk];
        first = false;
    }
    sizeMapStr += "}";

    function guideRatioStr(gr) {
        if (!gr) return "null";
        return '{ "top_ratio": ' + gr.top_ratio +
               ', "bottom_ratio": ' + gr.bottom_ratio + ' }';
    }
    function clampStr(cl) {
        return '{ "min": ' + cl.min + ', "max": ' + cl.max + ' }';
    }

    var json =
        "{\n" +
        '  "student": {\n' +
        '    "frame_w_mm": '   + studentW           + ',\n' +
        '    "frame_h_mm": '   + studentH           + ',\n' +
        '    "guide_ratios": ' + guideRatioStr(studentGuideRatios) + ',\n' +
        '    "scale_clamp": '  + clampStr(studentClamp) + '\n' +
        '  },\n' +
        '  "teacher": {\n' +
        '    "frame_w_mm": '   + r(teacherBounds.w, 2) + ',\n' +
        '    "frame_h_mm": '   + r(teacherBounds.h, 2) + ',\n' +
        '    "guide_ratios": ' + guideRatioStr(teacherGuideRatios) + ',\n' +
        '    "scale_clamp": '  + clampStr(teacherClamp) + '\n' +
        '  },\n' +
        '  "all_guide_y_positions_mm": [' + allGuideYs.join(", ") + '],\n' +
        '  "all_student_sizes_detected": ' + sizeMapStr + ',\n' +
        '  "source_document": "' + doc.name.replace(/\\/g, "\\\\") + '",\n' +
        '  "generated_at": "' + isoTimestamp() + '"\n' +
        '}';

    writeTextFile(CONFIG.outputFile, json);

    // ── Summary ───────────────────────────────────────────────────
    var guideNote = studentGuideRatios
        ? (" Student Guide ratios: top=" + studentGuideRatios.top_ratio +
           "  chin=" + studentGuideRatios.bottom_ratio)
        : "  ⚠ Student Guide ratios: not found — defaults used\n" +
          "    (Add red hairline rectangles on '" + CONFIG.guideLayer + "' layer)";

        var teacherGuideNote = teacherGuideRatios
                ? (" Teacher Guide ratios: top=" + teacherGuideRatios.top_ratio +
                     "  chin=" + teacherGuideRatios.bottom_ratio)
                : "  ⚠ Teacher Guide ratios: not found — defaults used\n" +
                    "    (Add red hairline rectangles on '" + CONFIG.portraitLayer + "' layer)";


    var summary =
        "\n════════════════════════════════════════════\n" +
        "✓ frame_config.json written\n" +
        "════════════════════════════════════════════\n" +
        "  Student frame : " + studentW + " × " + studentH + " mm\n" +
        "  Teacher frame : " + r(teacherBounds.w,2) + " × " + r(teacherBounds.h,2) + " mm\n" +
        guideNote + "\n" +
                teacherGuideNote + "\n" +
        "  Output        : " + CONFIG.outputFile + "\n\n" +
        "Next step: run face_offset_calculator.py\n" +
        "All target ratios are now computed automatically.\n";

    $.writeln(summary);
    alert(summary);

})();