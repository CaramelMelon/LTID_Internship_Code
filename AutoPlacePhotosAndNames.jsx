/*
 * — Layer-aware InDesign automation
 * =========================================================
 *
 * Reads a "Package" folder produced by run_pipeline.py and populates
 * an InDesign template with:
 *   - Best-shot portraits  →  "Default" / "本番カット" layer
 *   - ID plate (札) photos →  "札持ちカット" layer
 *   - Student names         →  "名前" layer text frames
 *
 * Expected package structure:
 *   package_folder/
 *     3-1/
 *       26_千早高_IMG_1234_3101_札01.jpg
 *       26_千早高_IMG_1234_3101_札02.jpg
 *       26_千早高_IMG_5678_3101_本01.jpg
 *       26_千早高_IMG_5679_3101_本02.jpg
 *       ...
 *     manifest.json
 *
 * Naming conventions (supports BOTH with auto-detection):
 *   NEW: [Year]_[SchoolName]_[OriginalFileName]_[Grade][Class][ID]_[Tag].ext
 *     Tags: 札01/札02... = ID plate shots, 本01/本02... = portrait priority
 *     Example: 26_上水高_IMG_2337_3105_札01.jpg (grade 3, class 1, no. 5)
 *   
 *   OLD (v10): [Year]_[SchoolName]_[OriginalFileName]_[Grade][Class][ID]_[Tag].ext
 *     Tags: 札 = ID plate, 本_01/本_02... = portrait priority
 *     Example: 26_上水高_IMG_2337_3105_札.jpg, 26_上水高_IMG_2337_3105_本_01.jpg
 *
 * Template requirements:
 *   - Layers named: "Default" (or "本番カット"), "札持ちカット", "名前",
 *     "顔位置ガイド", "クラスロゴ"
 *   - Frames on "Default" layer = portrait frames (one per student + teacher)
 *   - Frames on "札持ちカット" layer = ID plate frames (same count)
 *   - Text frames on "名前" layer = name labels (same count)
 *   - One large group-photo frame (detected automatically)
 *
 * Usage:
 *   1. Open InDesign
 *   2. Edit CONFIG below (paths)
 *   3. Run script via Scripts panel or File > Scripts > Run
 */

#target indesign

// ══════════════════════════════════════════════════════════════════
// CONFIGURATION — EDIT THESE
// ══════════════════════════════════════════════════════════════════

var CONFIG = {
    // Path to the InDesign template
    indesignFile: "D:\\career\\1_LTID\\Photography\\Client Sample Image\\20260224　個人写真_レイヤー概念など\\26千早高_個人レイアウト_template.indd",

    // Package folder produced by run_pipeline.py
    packageFolder: "D:\\career\\1_LTID\\Photography\\output_千早高_FINAL_v6\\3-1",

    // manifest.json (one level up from packageFolder)
    manifestFile: "D:\\career\\1_LTID\\Photography\\output_千早高_FINAL_v6\\manifest.json",

    // Class ID being placed (letter "A" or grade-class "3-7")
    classLetter: "3-1",

    // Group photo (optional — leave empty to skip)
    groupPhotoFile: "",

    // Teacher portrait (optional — if present in package as number 0 or "teacher")
    teacherPhotoFile: "",

    // Output file
    outputFile: "D:\\career\\1_LTID\\Photography\\output_千早高_FINAL_v6\\千早高_Class_3-1_Final.indd",

    // Layer names (must match the template)
    layers: {
        portrait:   "Default",          // also accepts "本番カット"
        idPlate:    "札持ちカット",
        name:       "名前",
        classLogo:  "クラスロゴ",
        faceGuide:  "顔位置ガイド"
    },

    // Absent students list (optional .txt file — numbers separated by comma/newline)
    // Leave empty "" to rely only on file-based absence detection
    absentFile: "",

    // Per-frame-type fitting controls (from teammate update)
    //   offsetX/Y = shift the image inside the frame after fitting (mm)
    //   scaleFactor = 100 means no change; 110 = 10% bigger; 122 = 22% bigger
    student: {
        offsetX:     -3.5,
        offsetY:     78.10,
        scaleFactor: 122
    },
    teacher: {
        offsetX:    -2.5,
        offsetY:    10.10,
        scaleFactor: 110
    },
    
    ignoreTeacherManifest: true,
    // ID plate (札) fitting controls
    //   offsetY positive = move down to show full head
    idPlate: {
        offsetX:     -3,
        offsetY:     6.5,       // No offset - center the ID plate photo
        scaleFactor: 135      // No additional scaling
    },

    // Fitting (used for ID-plate frames only)
    fittingMethod: "FILL_PROPORTIONALLY",

    // Behaviour
    autoSave: true,
    autoClose: false,

    // Which spread to place photos on.
    //   -1 = use the currently active/visible spread in InDesign (recommended)
    //    0 = first spread, 1 = second spread, etc.
    spreadIndex: -1
};


// ══════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ══════════════════════════════════════════════════════════════════

function sortFramesByPosition(frames) {
    /*
     * Sort frames into reading order: left-to-right columns,
     * top-to-bottom within each column.
     * Uses a 10mm snap tolerance for column alignment (robust for real templates).
     */
    frames.sort(function (a, b) {
        var ga = a.geometricBounds;   // [top, left, bottom, right]
        var gb = b.geometricBounds;
        var ax = ga[1], ay = ga[0];
        var bx = gb[1], by = gb[0];

        if (Math.abs(ax - bx) > 10) {
            return ax - bx;           // different column → sort by X
        }
        return ay - by;               // same column → sort by Y
    });
    return frames;
}


function findLargestFrame(frames) {
    /* Return index of the largest rectangle (group photo frame). */
    var maxArea = 0;
    var idx = -1;
    for (var i = 0; i < frames.length; i++) {
        var gb = frames[i].geometricBounds;
        var area = (gb[3] - gb[1]) * (gb[2] - gb[0]);
        if (area > maxArea) {
            maxArea = area;
            idx = i;
        }
    }
    return idx;
}


function findTeacherFrame(frames) {
    /*
     * The teacher frame is the largest among portrait frames
     * (after the group photo frame has been removed).
     */
    return findLargestFrame(frames);
}


function findClosestFrameIdx(frames, referenceFrame) {
    /*
     * Returns the index of the frame whose centre is geometrically
     * closest to the centre of referenceFrame.
     * Used to pair the teacher’s ID plate frame and name frame with
     * the teacher portrait frame so they can be removed before sorting.
     */
    if (!referenceFrame || frames.length === 0) return -1;
    var rb = referenceFrame.geometricBounds; // [top,left,bottom,right]
    var rcx = (rb[1] + rb[3]) / 2;
    var rcy = (rb[0] + rb[2]) / 2;
    var minDist = Infinity;
    var minIdx  = -1;
    for (var i = 0; i < frames.length; i++) {
        try {
            var fb  = frames[i].geometricBounds;
            var fcx = (fb[1] + fb[3]) / 2;
            var fcy = (fb[0] + fb[2]) / 2;
            var d   = Math.sqrt((fcx - rcx) * (fcx - rcx) + (fcy - rcy) * (fcy - rcy));
            if (d < minDist) { minDist = d; minIdx = i; }
        } catch (e) {}
    }
    return minIdx;
}


function smartFit(frame, scaleFactor, offsetX, offsetY) {
    // Used for ID-plate frames with optional offset support
    try {
        frame.fit(FitOptions.FILL_PROPORTIONALLY);
        frame.fit(FitOptions.CENTER_CONTENT);
        
        if (frame.allGraphics.length > 0) {
            var g = frame.allGraphics[0];
            
            // Apply scale factor
            if (scaleFactor && scaleFactor !== 100) {
                var s = scaleFactor / 100;
                g.horizontalScale *= s;
                g.verticalScale   *= s;
            }
            
            // Apply offsets if provided (in mm)
            if (offsetX !== undefined || offsetY !== undefined) {
                var ox = offsetX || 0;
                var oy = offsetY || 0;
                g.move(undefined, [ox + "mm", oy + "mm"]);
            } else {
                // Default: just center
                frame.fit(FitOptions.CENTER_CONTENT);
            }
        }
    } catch (e) {
        $.writeln("Fit error: " + e.message);
    }
}


function placeWithTransform(frame, imageFile, offsetX, offsetY, scaleFactor) {
    /*
     * Teammate update: place → fit proportionally → centre → scale → offset.
     * offsetX / offsetY move the graphic inside the frame (mm) after fitting.
     * This lets you fine-tune head position without touching the frame itself.
     */
    try {
        frame.place(imageFile);
        frame.fit(FitOptions.FILL_PROPORTIONALLY);
        frame.fit(FitOptions.CENTER_CONTENT);

        if (frame.allGraphics.length > 0) {
            var graphic = frame.allGraphics[0];

            if (scaleFactor && scaleFactor !== 100) {
                var sp = scaleFactor / 100;
                graphic.horizontalScale = graphic.horizontalScale * sp;
                graphic.verticalScale   = graphic.verticalScale   * sp;
            }

            // Apply manifest offsets explicitly in mm (independent of ruler unit settings)
            graphic.move(undefined, [offsetX + "mm", offsetY + "mm"]);

            $.writeln("  ✓ scale(" + scaleFactor + "%)" +
                      " offset(" + offsetX + "mm, " + offsetY + "mm)");
        }
    } catch (e) {
        $.writeln("  ✗ placeWithTransform error: " + e.message);
    }
}


function toNumberOrDefault(value, fallback) {
    var n = parseFloat(value);
    return isNaN(n) ? fallback : n;
}


function resolveFacePlacement(entry, fallbackSettings) {
    /*
     * Use per-person manifest face_offsets when available,
     * otherwise fall back to CONFIG defaults.
     */
    var fo = (entry && entry.face_offsets) ? entry.face_offsets : null;
    return {
        offsetX: toNumberOrDefault(fo ? fo.offsetX : undefined, fallbackSettings.offsetX),
        offsetY: toNumberOrDefault(fo ? fo.offsetY : undefined, fallbackSettings.offsetY),
        scaleFactor: toNumberOrDefault(fo ? fo.scaleFactor : undefined, fallbackSettings.scaleFactor),
        source: fo ? "manifest.face_offsets" : "CONFIG fallback"
    };
}


function pickManifestFileByPriority(filesObj, prefixes) {
    /*
     * Pick the lowest-numbered file key from manifest.files by prefix.
     * Supports numbered keys like 本01, 本02, 札01, 札02.
     */
    if (!filesObj) return null;

    var bestValue = null;
    var bestPriority = Infinity;

    for (var k in filesObj) {
        if (!filesObj.hasOwnProperty(k)) continue;
        for (var j = 0; j < prefixes.length; j++) {
            var pref = prefixes[j];
            if (k.indexOf(pref) !== 0) continue;

            // Accept keys like 本01 / 札02 and pick the lowest number.
            var suffix = k.substring(pref.length);
            if (!/^\d+$/.test(suffix)) continue;

            var pr = parseInt(suffix, 10);
            if (!isNaN(pr) && pr < bestPriority) {
                bestPriority = pr;
                bestValue = filesObj[k];
            }
        }
    }

    return bestValue;
}


function readAbsentNumbers(filePath) {
    /*
     * Teammate update: read a plain-text absent.txt and return an array
     * of absent student numbers.  Numbers can be comma- or newline-separated.
     */
    var list = [];
    if (!filePath || filePath.length === 0) return list;
    var f = new File(filePath);
    if (!f.exists) { $.writeln("⚠ absent.txt not found — skipping file-based absent list"); return list; }
    f.open("r");
    var content = f.read();
    f.close();
    content = content.replace(/\r\n/g, ",").replace(/\n/g, ",").replace(/\s+/g, ",");
    var parts = content.split(",");
    for (var i = 0; i < parts.length; i++) {
        var n = parseInt(parts[i], 10);
        if (!isNaN(n) && n > 0) list.push(n);
    }
    $.writeln("Absent (from file): " + list.join(", "));
    return list;
}


function isAbsent(num, list) {
    for (var i = 0; i < list.length; i++) {
        if (list[i] === num) return true;
    }
    return false;
}


function readJSON(filePath) {
    var f = new File(filePath);
    if (!f.exists) {
        $.writeln("✗ JSON file not found: " + filePath);
        return null;
    }
    f.open("r");
    var raw = f.read();
    f.close();
    // ExtendScript doesn't have JSON.parse — use eval (safe for our own files)
    try {
        return eval("(" + raw + ")");
    } catch (e) {
        $.writeln("✗ JSON parse error: " + e.message);
        return null;
    }
}


function getLayerByName(doc, name, altName) {
    /*
     * Find a layer by name. Try altName as fallback.
     * Returns layer object or null.
     */
    try { return doc.layers.itemByName(name); } catch (e) {}
    if (altName) {
        try { return doc.layers.itemByName(altName); } catch (e) {}
    }
    return null;
}


function getAllPageItems(container) {
    /*
     * Recursively collect all page items inside a spread or group,
     * so we find frames nested inside groups too.
     */
    var items = [];
    var top = container.allPageItems;
    for (var i = 0; i < top.length; i++) {
        items.push(top[i]);
    }
    return items;
}


function getFramesOnLayer(spread, layerName, altLayerName) {
    /*
     * Collect all rectangles on a specific layer within a spread,
     * including frames nested inside groups.
     */
    var frames = [];
    var allItems = getAllPageItems(spread);

    for (var i = 0; i < allItems.length; i++) {
        var item = allItems[i];
        // Must be a Rectangle (not text frame, not group)
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


function getTextFramesOnLayer(spread, layerName) {
    var frames = [];
    var allItems = getAllPageItems(spread);
    for (var i = 0; i < allItems.length; i++) {
        var item = allItems[i];
        if (item.constructor.name !== "TextFrame") continue;
        try {
            if (item.itemLayer.name === layerName) {
                frames.push(item);
            }
        } catch (e) {}
    }
    return frames;
}


function formatNameForTemplate(name) {
    /*
     * Replicates the InDesign template's kanji-spacing convention:
     *   - A fullwidth underscore \uff3f (＿) is inserted between every pair
     *     of consecutive kanji characters (CJK ideographs).
     *   - A space (half-width or full-width) that sits between kanji on both
     *     sides is also replaced by ＿ (so "臼田 安那" → "臼＿田＿安＿那").
     *   - Non-kanji characters (katakana, hiragana, latin, digits) and the
     *     spaces around them are left untouched.
     *
     * Examples:
     *   "臼田 安那"          → "臼＿田＿安＿那"
     *   "梅澤 愛蘭"          → "梅＿澤＿愛＿蘭"
     *   "アーカー ポンミャッ ライン" → unchanged
     *   "一ノ瀬 晴"          → "一ノ瀬＿晴"  (ノ breaks the kanji run)
     */
    if (!name) return name;

    var U = "\uff3f"; // ＿ fullwidth underscore

    function isKanji(ch) {
        if (!ch) return false;
        var c = ch.charCodeAt(0);
        // CJK Unified Ideographs U+4E00–U+9FFF
        // CJK Extension A       U+3400–U+4DBF
        // CJK Compat Ideographs  U+F900–U+FAFF
        return (c >= 0x4E00 && c <= 0x9FFF) ||
               (c >= 0x3400 && c <= 0x4DBF) ||
               (c >= 0xF900 && c <= 0xFAFF);
    }

    // Pass 1: replace spaces that sit between kanji on both sides with ＿
    var p1 = "";
    for (var i = 0; i < name.length; i++) {
        var ch = name.charAt(i);
        if (ch === " " || ch === "\u3000") {
            var leftK = false, rightK = false;
            for (var l = i - 1; l >= 0; l--) {
                if (name.charAt(l) !== " " && name.charAt(l) !== "\u3000") {
                    leftK = isKanji(name.charAt(l)); break;
                }
            }
            for (var r = i + 1; r < name.length; r++) {
                if (name.charAt(r) !== " " && name.charAt(r) !== "\u3000") {
                    rightK = isKanji(name.charAt(r)); break;
                }
            }
            p1 += (leftK && rightK) ? U : ch;
        } else {
            p1 += ch;
        }
    }

    // Pass 2: insert ＿ between every pair of directly adjacent kanji
    var res = "";
    for (var j = 0; j < p1.length; j++) {
        res += p1.charAt(j);
        if (isKanji(p1.charAt(j)) && isKanji(p1.charAt(j + 1))) {
            res += U;
        }
    }
    return res;
}


function sampleUnderscoreStyle(story) {
    /*
     * Before we overwrite the story content, scan the existing text for a
     * ＿ character (U+FF3F) and capture its character style + fill color.
     * Returns an object { charStyle, fillColor } or null if none found.
     * We use this to re-apply the template's cyan underscore styling after
     * writing new names.
     */
    try {
        var chars = story.characters;
        for (var i = 0; i < chars.length; i++) {
            if (chars[i].contents === "\uff3f") {
                var cs = null, fc = null;
                try { cs = chars[i].appliedCharacterStyle; } catch (e) {}
                try { fc = chars[i].fillColor; } catch (e) {}
                if (cs || fc) {
                    $.writeln("  ✓ Sampled underscore style from template");
                    return { charStyle: cs, fillColor: fc };
                }
            }
        }
    } catch (e) {}
    return null;
}


function applyUnderscoreStyle(story, styleInfo) {
    /*
     * After writing new name text, find every ＿ (U+FF3F) character in the
     * story and re-apply the sampled character style and fill color so the
     * underscores look identical to the original template (cyan, styled).
     */
    if (!styleInfo) return;
    try {
        var chars = story.characters;
        var count = 0;
        for (var i = 0; i < chars.length; i++) {
            if (chars[i].contents === "\uff3f") {
                try {
                    if (styleInfo.charStyle && styleInfo.charStyle.isValid) {
                        chars[i].appliedCharacterStyle = styleInfo.charStyle;
                    }
                    if (styleInfo.fillColor && styleInfo.fillColor.isValid) {
                        chars[i].fillColor = styleInfo.fillColor;
                    }
                    count++;
                } catch (e) {}
            }
        }
        if (count > 0) $.writeln("  ✓ Underscore style applied to " + count + " characters");
    } catch (e) {
        $.writeln("  ⚠ applyUnderscoreStyle error: " + e.message);
    }
}


function centerNameFrameText(frame) {
    /*
     * Center text inside a name frame both horizontally and vertically.
     * Works for standalone and threaded text frames.
     */
    if (!frame) return;
    try {
        frame.textFramePreferences.verticalJustification = VerticalJustification.CENTER_ALIGN;
    } catch (e) {}

    try {
        frame.texts[0].justification = Justification.CENTER_ALIGN;
    } catch (e2) {}
}


function placeNamesInFrames(nameFrames, frameNames) {
    /*
     * Correctly places one name per text frame, handling both threaded
     * and non-threaded (standalone) frames.
     *
     * frameNames: array indexed by frame position (same order as nameFrames)
     *             each entry is a name string, or "" for absent/no name.
     *
     * Also preserves the template's ＿ character styling (e.g. cyan color)
     * by sampling it from the existing template content before overwriting,
     * then re-applying it to every ＿ in the newly written text.
     */

    // ── Group frames by their parentStory ──
    var groups = [];   // [{storyRef, frames:[{frame,idx}]}]

    for (var i = 0; i < nameFrames.length; i++) {
        var tf = nameFrames[i];
        var storyRef;
        try { storyRef = tf.parentStory; } catch (e) { storyRef = null; }

        var found = -1;
        for (var g = 0; g < groups.length; g++) {
            if (groups[g].storyRef === storyRef) { found = g; break; }
        }
        if (found >= 0) {
            groups[found].frames.push({ frame: tf, idx: i });
        } else {
            groups.push({ storyRef: storyRef, frames: [{ frame: tf, idx: i }] });
        }
    }

    $.writeln("  Name story groups: " + groups.length +
              " (" + nameFrames.length + " frames total)");

    // ── Fill each group ──
    for (var g = 0; g < groups.length; g++) {
        var grp = groups[g];
        // Ensure frames are in position order within the group
        grp.frames.sort(function (a, b) { return a.idx - b.idx; });

        if (grp.frames.length === 1) {
            // ── Standalone frame: clear then set ──
            var tf = grp.frames[0].frame;
            var name = frameNames[grp.frames[0].idx] || "";
            try { tf.contents = ""; } catch (e) {}
            if (name) {
                try {
                    tf.contents = name;
                    $.writeln("  ✓ frame[" + grp.frames[0].idx + "] = " + name);
                    // Auto-shrink if name overflows the standalone frame
                    var minPt = 6;
                    var shrinkAttempts = 0;
                    while (tf.overflows && shrinkAttempts < 40) {
                        try {
                            var chars = tf.parentStory.characters;
                            var curSz = chars[0].pointSize;
                            if (curSz <= minPt) break;
                            for (var sci = 0; sci < chars.length; sci++) {
                                chars[sci].pointSize = curSz - 0.5;
                            }
                        } catch (e2) { break; }
                        shrinkAttempts++;
                    }
                    if (shrinkAttempts > 0) $.writeln("  ⚠ Shrunk standalone frame font ×" + shrinkAttempts + " for: " + name);
                } catch (e) {
                    $.writeln("  ✗ frame[" + grp.frames[0].idx + "] error: " + e.message);
                }
            }

            // Keep name centered in the frame regardless of content length.
            centerNameFrameText(tf);
        } else {
            // ── Threaded story: set whole story at once ──
            var parts = [];
            for (var j = 0; j < grp.frames.length; j++) {
                parts.push(frameNames[grp.frames[j].idx] || "");
            }
            var fullContent = parts.join("\r");
            try {
                grp.storyRef.contents = fullContent;
                $.writeln("  ✓ threaded story (" + grp.frames.length +
                          " frames) filled with " + grp.frames.length + " names");
            } catch (e) {
                $.writeln("  ⚠ story.contents failed (" + e.message +
                          "), trying frame[0].contents fallback");
                try { grp.frames[0].frame.contents = fullContent; } catch (e2) {}
            }

            // ── Auto-shrink: ensure each paragraph stays within its assigned frame ──
            // If a long name overflows its frame it pushes all subsequent names
            // one frame forward. Fix: reduce that paragraph's font size until the
            // next paragraph's first character lands in the expected next frame.
            var minPtSize = 6;
            var storyParas = grp.storyRef.paragraphs;
            for (var pi = 0; pi < storyParas.length - 1 && pi < grp.frames.length - 1; pi++) {
                var thisPara   = storyParas[pi];
                var nextPara   = storyParas[pi + 1];
                var nextFrame  = grp.frames[pi + 1].frame;
                for (var att = 0; att < 60; att++) {
                    try {
                        // Check where the first character of the NEXT paragraph is displayed
                        if (nextPara.characters.length === 0) break;
                        var nextFirstChar = nextPara.characters[0];
                        var dispFrames = nextFirstChar.parentTextFrames;
                        var inRightFrame = false;
                        for (var dfi = 0; dfi < dispFrames.length; dfi++) {
                            if (dispFrames[dfi] === nextFrame) { inRightFrame = true; break; }
                        }
                        if (inRightFrame) break; // this para fits correctly

                        // This paragraph overflows — shrink its font by 0.5pt
                        var paraChars = thisPara.characters;
                        if (paraChars.length === 0) break;
                        var curSz2 = paraChars[0].pointSize;
                        if (curSz2 <= minPtSize) break;
                        var newSz = curSz2 - 0.5;
                        for (var pci = 0; pci < paraChars.length; pci++) {
                            try { paraChars[pci].pointSize = newSz; } catch (e3) {}
                        }
                    } catch (e4) { break; }
                }
                if (att > 0) $.writeln("  ⚠ Shrunk para[" + pi + "] font ×" + att + " to fit frame");
            }

            // Center text in every frame in the threaded chain.
            for (var cj = 0; cj < grp.frames.length; cj++) {
                centerNameFrameText(grp.frames[cj].frame);
            }
        }
    }
}


function buildFileMap(folderPath) {
    /*
     * Scan the package folder and build a lookup:
    *   { "1": { "本01": File, "札01": File }, "2": { ... }, ... }
     *
     * Supports BOTH naming conventions with automatic fallback:
     * 
     * NEW convention: [Year]_[SchoolName]_[OriginalFileName]_[Grade][Class][ID]_[Tag].ext
     *   Example: 26_千早高_IMG_5678_3101_本01.jpg  → number=1, portrait priority=1
     *            26_千早高_IMG_1234_3101_札02.jpg → number=1, ID-plate priority=2
     *
     * OLD convention (v10): [Year]_[SchoolName]_[OriginalFileName]_[Grade][Class][ID]_[Tag].ext
     *   Example: 26_千早高_IMG_5678_3101_本_01.jpg → number=1, portrait priority=1
     *            26_千早高_IMG_1234_3101_札.jpg    → number=1, ID-plate
     *
     * We keep only files the script needs per student:
     *   - Portrait: prefer 本01, fallback 本02, 本03, ...
     *   - ID plate: prefer 札01, fallback 札02, 札03, ...
     *
    * Internal map keys (normalized):
    *   "本01" = selected portrait file
    *   "札01" = selected ID-plate file
     *
     * Teacher files such as "..._31先生_札.JPG" are ignored here
     * because teacher placement is driven by manifest entries.
     */

    function parseStudentFileName(fname) {
        var base = fname.replace(/\.[^.]+$/, "");
        var parts = base.split("_");
        var idToken = null;
        var kind = null;
        var priority = null;

        // Try NEW convention first: ..._[GradeClassID]_札01 or ..._[GradeClassID]_本01
        if (parts.length >= 2) {
            var last = parts[parts.length - 1];
            var mId = last.match(/^札(\d+)$/);
            var mPortrait = last.match(/^本(\d+)$/);

            if (mId) {
                idToken = parts[parts.length - 2];
                kind = "札01";
                priority = parseInt(mId[1], 10);
            } else if (mPortrait) {
                idToken = parts[parts.length - 2];
                kind = "本01";
                priority = parseInt(mPortrait[1], 10);
            }
        }

        // Try OLD convention (v10): ..._[GradeClassID]_札 or ..._[GradeClassID]_本_01
        if (!kind && parts.length >= 2) {
            var last = parts[parts.length - 1];
            
            // Old style ID plate: ..._[GradeClassID]_札
            if (last === "札") {
                idToken = parts[parts.length - 2];
                kind = "札01";
                priority = 1; // Old style札 has no priority number, treat as priority 1
            }
            // Old style portrait: ..._[GradeClassID]_本_01
            else if (parts.length >= 3 && parts[parts.length - 2] === "本" && /^\d+$/.test(last)) {
                idToken = parts[parts.length - 3];
                kind = "本01";
                priority = parseInt(last, 10);
            }
        }

        if (idToken && kind) {
            // Teacher token example: 31先生
            if (idToken.indexOf("先生") !== -1) return null;

            // [Grade][Class][ID] → use trailing 2 digits as student ID
            // Examples: 3101 -> 1, 3312 -> 12, 31001 -> 1
            var tail2 = idToken.match(/(\d{2})$/);
            var num = null;
            if (tail2) {
                num = parseInt(tail2[1], 10);
            } else if (/^\d+$/.test(idToken)) {
                // Fallback for older/simple numeric token
                num = parseInt(idToken, 10);
            }

            if (!isNaN(num) && num > 0) {
                return { number: num, kind: kind, priority: priority || 9999 };
            }
            return null;
        }

        return null;
    }

    var folder = new Folder(folderPath);
    if (!folder.exists) {
        $.writeln("✗ Package folder not found: " + folderPath);
        return {};
    }

    var files = folder.getFiles(/\.(jpg|jpeg|png|tif|tiff|psd)$/i);
    var map = {};

    for (var i = 0; i < files.length; i++) {
        var fname = decodeURI(files[i].name);
        var parsed = parseStudentFileName(fname);
        if (!parsed) continue;

        var num = parsed.number;
        var kind = parsed.kind;
        var priority = parsed.priority;
        var key = String(num);

        if (!map[key]) map[key] = {};

        // Keep the lowest-numbered shot for each required kind.
        // (e.g. prefer 本01 over 本02; 札01 over 札02)
        if (!map[key][kind] || priority < map[key][kind].priority) {
            map[key][kind] = { file: files[i], priority: priority };
        }
    }

    // Flatten wrappers so placement logic gets File objects directly.
    for (var skey in map) {
        if (!map.hasOwnProperty(skey)) continue;
        for (var tkey in map[skey]) {
            if (!map[skey].hasOwnProperty(tkey)) continue;
            map[skey][tkey] = map[skey][tkey].file;
        }
    }

    return map;
}

// Updated highlightAbsentFrame to place a PSD file instead of coloring
function highlightAbsentFrame(frame) {
    try {
        var absentImagePath = "D:\\career\\LTID\\Photography\\Client Sample Image\\20260306　篠崎高_個人_39人ブランク\\absent-bg.png";
        var absentImage = new File(absentImagePath);

        if (!absentImage.exists) {
            $.writeln("⚠ Absent image file not found: " + absentImagePath);
            return;
        }

        frame.place(absentImage);
        frame.fit(FitOptions.FILL_PROPORTIONALLY);
        frame.fit(FitOptions.CENTER_CONTENT);

        $.writeln("  ✓ Absent frame filled with image: " + absentImagePath);
    } catch (e) {
        $.writeln("  ✗ Error placing absent image: " + e.message);
    }
}


// ══════════════════════════════════════════════════════════════════
// MAIN SCRIPT
// ══════════════════════════════════════════════════════════════════

(function main() {

    $.writeln("╔══════════════════════════════════════════╗");
    $.writeln("║  AutoPlacePhotos v8 — Layer-Aware        ║");
    $.writeln("╚══════════════════════════════════════════╝");

    // ── Validate paths ──
    var templateFile = new File(CONFIG.indesignFile);
    if (!templateFile.exists) {
        alert("ERROR: InDesign template not found!\n" + CONFIG.indesignFile);
        return;
    }

    var pkgFolder = new Folder(CONFIG.packageFolder);
    if (!pkgFolder.exists) {
        alert("ERROR: Package folder not found!\n" + CONFIG.packageFolder);
        return;
    }

    // ── Read manifest ──
    var manifest = null;
    var nameMap = {};    // number -> name string
    var entryMap = {};   // number -> full manifest entry

    if (CONFIG.manifestFile) {
        var fullManifest = readJSON(CONFIG.manifestFile);
        if (fullManifest && fullManifest.classes && fullManifest.classes[CONFIG.classLetter]) {
            manifest = fullManifest.classes[CONFIG.classLetter];
            // Build name lookup
            var entries = manifest.entries || [];
            for (var e = 0; e < entries.length; e++) {
                nameMap[String(entries[e].number)] = entries[e].name;
                entryMap[String(entries[e].number)] = entries[e];
            }
            $.writeln("✓ Manifest loaded: " + entries.length + " entries");
        } else {
            $.writeln("⚠ Manifest not found or class missing — will skip name injection");
        }
    }

    // ── Build file map ──
    var fileMap = buildFileMap(CONFIG.packageFolder);
    var studentNums = [];
    for (var k in fileMap) {
        if (fileMap.hasOwnProperty(k)) studentNums.push(parseInt(k, 10));
    }
    studentNums.sort(function(a, b) { return a - b; });
    $.writeln("✓ Found files for students: " + studentNums.join(", "));

    // // ── Open document (or use already-open one) ──
    // var doc = null;
    // var templateName = templateFile.name;
    // for (var di = 0; di < app.documents.length; di++) {
    //     // ── Use currently active document ONLY ──
    // if (app.documents.length === 0) {
    //     alert("No document is open. Please open the InDesign file first.");
    //     return;
    // }

    // var doc = app.activeDocument;
    // $.writeln("✓ Using active document: " + doc.name);
    // }

    // ── Open document (or use already-open one) ──
    var doc;

    if (app.documents.length > 0) {
        doc = app.activeDocument;
        $.writeln("✓ Using active document: " + doc.name);
    } else {
        doc = app.open(templateFile);
        $.writeln("✓ Opened template: " + doc.name);
    }
    // if (!doc) {
    //     doc = app.open(templateFile);
    //     $.writeln("✓ Opened template: " + doc.name);
    // }

    // ── Select the correct spread ──
    var spread;
    if (CONFIG.spreadIndex >= 0) {
        if (CONFIG.spreadIndex >= doc.spreads.length) {
            alert("ERROR: spreadIndex " + CONFIG.spreadIndex + " is out of range. Document has " + doc.spreads.length + " spreads (0–" + (doc.spreads.length - 1) + ").");
            return;
        }
        spread = doc.spreads[CONFIG.spreadIndex];
        $.writeln("✓ Using spread index " + CONFIG.spreadIndex + " (pages " + spread.pages[0].name + "–" + spread.pages[spread.pages.length - 1].name + ")");
    } else {
        // Use spread of currently active page (safer than activeSpread)
        if (app.layoutWindows.length === 0) {
            alert("No active layout window found.");
            return;
        }

        var activePage = app.layoutWindows[0].activePage;
        spread = activePage.parent;

        $.writeln("✓ Using spread of active page: " +
            spread.pages[0].name + "–" +
            spread.pages[spread.pages.length - 1].name);
    }

    // ── Get portrait frames (Default / 本番カット layer) ──
    var portraitFrames = getFramesOnLayer(spread, CONFIG.layers.portrait, "本番カット");
    $.writeln("  Portrait frames on '" + CONFIG.layers.portrait + "': " + portraitFrames.length);

    // ── Get ID plate frames (札持ちカット layer) ──
    var idPlateFrames = getFramesOnLayer(spread, CONFIG.layers.idPlate);
    $.writeln("  ID plate frames on '" + CONFIG.layers.idPlate + "': " + idPlateFrames.length);

    // ── Get name text frames ──
    var nameFrames = getTextFramesOnLayer(spread, CONFIG.layers.name);
    $.writeln("  Name text frames on '" + CONFIG.layers.name + "': " + nameFrames.length);

    // ── Separate group frame from portrait frames ──
    var groupFrameIdx = findLargestFrame(portraitFrames);
    var groupFrame = null;
    if (groupFrameIdx >= 0) {
        groupFrame = portraitFrames[groupFrameIdx];
        portraitFrames.splice(groupFrameIdx, 1);
        $.writeln("✓ Group photo frame identified");
    }

    // ── Separate teacher frame ──
    var teacherIdx = findTeacherFrame(portraitFrames);
    var teacherFrame = null;
    if (teacherIdx >= 0) {
        teacherFrame = portraitFrames[teacherIdx];
        portraitFrames.splice(teacherIdx, 1);
        $.writeln("✓ Teacher portrait frame identified");
    }

    // ── Separate teacher ID plate frame (closest to teacher portrait) ──
    var teacherIdFrame = null;
    if (teacherFrame) {
        var tidIdx = findClosestFrameIdx(idPlateFrames, teacherFrame);
        if (tidIdx >= 0) {
            teacherIdFrame = idPlateFrames[tidIdx];
            idPlateFrames.splice(tidIdx, 1);
            $.writeln("✓ Teacher ID plate frame identified");
        }
    }

    // ── Separate teacher name frame (closest to teacher portrait) ──
    var teacherNameFrame = null;
    if (teacherFrame) {
        var tnIdx = findClosestFrameIdx(nameFrames, teacherFrame);
        if (tnIdx >= 0) {
            teacherNameFrame = nameFrames[tnIdx];
            nameFrames.splice(tnIdx, 1);
            $.writeln("✓ Teacher name frame identified");
        }
    }

    // ── Sort remaining (student) frames ──
    portraitFrames = sortFramesByPosition(portraitFrames);
    idPlateFrames  = sortFramesByPosition(idPlateFrames);
    nameFrames     = sortFramesByPosition(nameFrames);

    $.writeln("✓ Student portrait frames: " + portraitFrames.length);

    // frameNames[i] will hold the name string for nameFrames[i]; built during
    // the student loop below and written to frames in one pass afterward.
    var frameNames = [];
    for (var fi = 0; fi < nameFrames.length; fi++) { frameNames[fi] = ""; }

    // ── Place group photo ──
    if (groupFrame && CONFIG.groupPhotoFile) {
        var gpFile = new File(CONFIG.groupPhotoFile);
        if (gpFile.exists) {
            groupFrame.place(gpFile);
            groupFrame.fit(FitOptions.FILL_PROPORTIONALLY);
            $.writeln("✓ Group photo placed");
        }
    }

    // ── Load absent list from file (teammate update) ──
    var absentList = readAbsentNumbers(CONFIG.absentFile);

    // ── Place teacher from manifest entry (number 0 / is_teacher) ──
    var teacherEntry = null;
    if (manifest) {
        var entries2 = manifest.entries || [];
        for (var te = 0; te < entries2.length; te++) {
            if (entries2[te].is_teacher || entries2[te].number === 0) {
                teacherEntry = entries2[te];
                break;
            }
        }
    }

    var teacherPlacement;

    if (CONFIG.ignoreTeacherManifest) {
        // Ignore manifest offsets → use CONFIG
        teacherPlacement = {
            offsetX: CONFIG.teacher.offsetX,
            offsetY: CONFIG.teacher.offsetY,
            scaleFactor: CONFIG.teacher.scaleFactor,
            source: "CONFIG.teacher (ignore manifest)"
        };
    } else {
        // Use manifest if available
        teacherPlacement = resolveFacePlacement(teacherEntry, CONFIG.teacher);
    }

    if (teacherFrame && teacherEntry && teacherEntry.files) {
        // Portrait → 本_01
        var tPortrait = teacherEntry.files["本_01"];
        if (tPortrait) {
            var tPortraitFile = new File(CONFIG.packageFolder + "/" + tPortrait);
            if (tPortraitFile.exists) {
                placeWithTransform(teacherFrame, tPortraitFile,
                    teacherPlacement.offsetX, teacherPlacement.offsetY, teacherPlacement.scaleFactor);
                $.writeln("✓ Teacher portrait placed: " + tPortrait);
                $.writeln("  -> Teacher offsets from " + teacherPlacement.source +
                          " (x=" + teacherPlacement.offsetX +
                          ", y=" + teacherPlacement.offsetY +
                          ", scale=" + teacherPlacement.scaleFactor + "%)");
            } else {
                $.writeln("⚠ Teacher portrait not found: " + tPortraitFile.fsName);
            }
        }
        // ID plate → 札
        if (teacherIdFrame && teacherEntry.files["札"]) {
            var tIdFile = new File(CONFIG.packageFolder + "/" + teacherEntry.files["札"]);
            if (tIdFile.exists) {
                teacherIdFrame.place(tIdFile);
                smartFit(teacherIdFrame, CONFIG.idPlate.scaleFactor,
                         CONFIG.idPlate.offsetX, CONFIG.idPlate.offsetY);
                $.writeln("✓ Teacher ID plate placed (offset Y=" + CONFIG.idPlate.offsetY + "mm)");
            }
        }
        // Name
        if (teacherNameFrame) {
            var tName = teacherEntry.name || "";
            try {
                // Sample paragraph style point size BEFORE overwriting
                // (template may have character-level size overrides that cause mixed sizes)
                var tTargetSize = null;
                try {
                    var tPS = teacherNameFrame.paragraphs[0].appliedParagraphStyle;
                    var tPSSize = tPS.pointSize;
                    if (tPSSize && tPSSize > 0) tTargetSize = tPSSize;
                } catch (e) {}
                // Fallback: use the minimum size found (treat larger chars as accidental overrides)
                if (!tTargetSize) {
                    try {
                        var tMinSize = Infinity;
                        var tExistChars = teacherNameFrame.characters;
                        for (var tci = 0; tci < tExistChars.length; tci++) {
                            var tChSz = tExistChars[tci].pointSize;
                            if (tChSz > 0 && tChSz < tMinSize) tMinSize = tChSz;
                        }
                        if (tMinSize < Infinity) tTargetSize = tMinSize;
                    } catch (e) {}
                }

                // Set the name content
                teacherNameFrame.contents = tName;

                // Normalize: stamp every character with the same point size
                if (tTargetSize) {
                    var tNameChars = teacherNameFrame.characters;
                    for (var tci2 = 0; tci2 < tNameChars.length; tci2++) {
                        try { tNameChars[tci2].pointSize = tTargetSize; } catch (e) {}
                    }
                    $.writeln("  ✓ Teacher name font size normalized to " + tTargetSize + "pt");
                }

                centerNameFrameText(teacherNameFrame);

                $.writeln("✓ Teacher name set: " + tName);
            } catch (e) {
                $.writeln("  ✗ Teacher name error: " + e.message);
            }
        }
    } else if (teacherFrame && CONFIG.teacherPhotoFile) {
        // Fallback: use the manually configured file path
        var tFile2 = new File(CONFIG.teacherPhotoFile);
        if (tFile2.exists) {
            placeWithTransform(teacherFrame, tFile2,
                CONFIG.teacher.offsetX, CONFIG.teacher.offsetY, CONFIG.teacher.scaleFactor);
            $.writeln("✓ Teacher photo placed (CONFIG path)");
        }
    } else {
        $.writeln("⚠ No teacher entry found in manifest and CONFIG.teacherPhotoFile is empty — teacher frame left blank");
    }

    // ── Place student photos ──
    var placed = 0;
    var absent = 0;
    var maxStudent = manifest ? manifest.total_students : portraitFrames.length;
    var frameIdx = 0;

    for (var studentNum = 1; studentNum <= maxStudent; studentNum++) {
        var key = String(studentNum);
        var data = fileMap[key];
        var studentName = nameMap[key] || "";
        var studentEntry = entryMap[key] || null;
        var studentPlacement = resolveFacePlacement(studentEntry, CONFIG.student);

        if (frameIdx >= portraitFrames.length) {
            $.writeln("⚠ Ran out of portrait frames at student #" + studentNum);
            break;
        }

        // Check absent via absent.txt (teammate update) OR via missing files
        // Support both old format (本_01, 札) and new format (本01, 札01)
        var hasPortrait = data && (data["本_01"] || data["本01"]);
        var hasIdPlate = data && (data["札"] || data["札01"]);
        if (isAbsent(studentNum, absentList) || !data || (!hasPortrait && !hasIdPlate)) {
            $.writeln("⊗ Student #" + studentNum + " (" + studentName + "): ABSENT — photo frames filled with absent image, name kept");
            highlightAbsentFrame(portraitFrames[frameIdx]);  // Use updated function to place absent image in portrait frame

            if (frameIdx < idPlateFrames.length) {
                highlightAbsentFrame(idPlateFrames[frameIdx]);  // Use updated function to place absent image in ID plate frame
            }

            // ── Name → still assign even for absent students ──
            if (frameIdx < nameFrames.length) {
                frameNames[frameIdx] = studentName;
            }

            absent++;
            frameIdx++;   // advance frame (portrait/ID left as absent image)
            continue;
        }

        // ── Portrait (本_01 or 本01) → Default layer — now uses placeWithTransform ──
        var portraitFile = data["本_01"] || data["本01"];
        if (portraitFile) {
            placeWithTransform(
                portraitFrames[frameIdx], portraitFile,
                studentPlacement.offsetX,
                studentPlacement.offsetY,
                studentPlacement.scaleFactor
            );
            $.writeln("✓ #" + studentNum + " portrait placed");
            $.writeln("  -> #" + studentNum + " offsets from " + studentPlacement.source +
                      " (x=" + studentPlacement.offsetX +
                      ", y=" + studentPlacement.offsetY +
                      ", scale=" + studentPlacement.scaleFactor + "%)");
        }

        // ── ID Plate (札 or 札01) → 札持ちカット layer — now with offset support ──
        var idPlateFile = data["札"] || data["札01"];
        if (idPlateFile && frameIdx < idPlateFrames.length) {
            idPlateFrames[frameIdx].place(idPlateFile);
            smartFit(idPlateFrames[frameIdx], CONFIG.idPlate.scaleFactor,
                     CONFIG.idPlate.offsetX, CONFIG.idPlate.offsetY);
            $.writeln("  ✓ #" + studentNum + " ID plate placed (offset Y=" + CONFIG.idPlate.offsetY + "mm)");
        }

        // ── Name → collect for batch write after loop ──
        if (frameIdx < nameFrames.length) {
            frameNames[frameIdx] = studentName;
        }

        placed++;
        frameIdx++;
    }

    // ── Write all names to their text frames (handles threading correctly) ──
    $.writeln("Writing names to " + nameFrames.length + " name frames…");
    placeNamesInFrames(nameFrames, frameNames);

    // ── Save ──
    if (CONFIG.autoSave && CONFIG.outputFile) {
        var saveFile = new File(CONFIG.outputFile);
        doc.save(saveFile);
        $.writeln("✓ Saved: " + CONFIG.outputFile);
    }

    if (CONFIG.autoClose) {
        doc.close(SaveOptions.NO);
    }

    // Summary
    var summary =
        "\n════════════════════════════════════════\n" +
        "✓ AutoPlacePhotos v8 COMPLETE\n" +
        "════════════════════════════════════════\n" +
        "  Class    : " + CONFIG.classLetter + "\n" +
        "  Placed   : " + placed + "\n" +
        "  Absent   : " + absent + "\n" +
        "  Teacher  : " + (CONFIG.teacherPhotoFile ? "yes" : "—") + "\n" +
        "  Group    : " + (CONFIG.groupPhotoFile ? "yes" : "—") + "\n" +
        "  Output   : " + (CONFIG.outputFile || "not saved") + "\n";

    $.writeln(summary);
    alert(summary);

})();
