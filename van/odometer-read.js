// Reads the odometer number from a close-up photo, inside the phone (free, open-source Tesseract.js — nothing is sent
// to a paid service). It only SUGGESTS a number; the driver always confirms or corrects it.
//   OdometerRead.pickMileage(texts, lastKnown)  — pure: choose the most believable mileage from raw reader output
//   OdometerRead.readFile(file, lastKnown)       — browser: photo File -> number or null
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OdometerRead = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

  // every plausible odometer-looking number in one chunk of text
  function candidatesFrom(text) {
    var out = [];
    (String(text || '').match(/\d[\d.,]*\d|\d/g) || []).forEach(function (tok) {
      var t = tok.replace(/,/g, ''), parts = t.split('.');
      if (parts.length > 2) return;
      var intPart = parts[0], dec = parts[1] || '';
      if (dec.length > 1) dec = dec.charAt(0);                                  // an odometer shows one decimal; a second digit is usually the "mi" unit read as a number
      if (intPart.length < 4 || intPart.length > 7) return;                      // a van odometer: 4-7 digits
      out.push(parseFloat(dec ? intPart + '.' + dec : intPart));
      // readers often drop the little decimal point: "760161" really means 76016.1
      if (!dec && intPart.length >= 6) out.push(parseFloat(intPart.slice(0, -1) + '.' + intPart.slice(-1)));
    });
    return out;
  }

  // texts: one raw string per image variant. lastKnown: the van's previous odometer reading (an odometer only goes up).
  function pickMileage(texts, lastKnown) {
    var counts = {};
    (texts || []).forEach(function (t) {
      var seen = {};
      candidatesFrom(t).forEach(function (v) { if (!seen[v]) { seen[v] = 1; counts[v] = (counts[v] || 0) + 1; } });
    });
    var vals = Object.keys(counts).map(Number);
    if (!vals.length) return null;
    var last = Number(lastKnown);
    var hasLast = isFinite(last) && last > 0;
    var pool = hasLast ? vals.filter(function (v) { return v >= last - 2 && v <= last + 5000; }) : vals.filter(function (v) { return v >= 10000; });
    if (!pool.length) return null;
    pool.sort(function (a, b) {
      if (counts[b] !== counts[a]) return counts[b] - counts[a];                     // seen in more variants first
      return hasLast ? Math.abs(a - last) - Math.abs(b - last) : b - a;              // then nearest the last reading
    });
    return Math.round(pool[0] * 10) / 10;
  }

  // ---- browser only below ----
  var tessPromise = null;
  function loadTesseract() {
    if (typeof window !== 'undefined' && window.Tesseract) return Promise.resolve(window.Tesseract);
    if (!tessPromise) tessPromise = new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = TESSERACT_URL;
      s.onload = function () { res(window.Tesseract); };
      s.onerror = function () { tessPromise = null; rej(new Error('reader unavailable')); };
      document.head.appendChild(s);
    });
    return tessPromise;
  }
  function bitmapOf(file) {
    if (window.createImageBitmap) return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return viaImg(file); });
    return viaImg(file);
  }
  function viaImg(file) {
    return new Promise(function (res, rej) {
      var u = URL.createObjectURL(file), im = new Image();
      im.onload = function () { URL.revokeObjectURL(u); res(im); };
      im.onerror = function () { URL.revokeObjectURL(u); rej(new Error('bad image')); };
      im.src = u;
    });
  }
  // grayscale + contrast stretch; returns [normal, inverted] canvases (a lit green screen reads better inverted)
  function variantsOf(bmp) {
    var w = bmp.width, h = bmp.height, s = Math.min(1, 1400 / Math.max(w, h));
    var cw = Math.round(w * s), ch = Math.round(h * s);
    var c = document.createElement('canvas'); c.width = cw; c.height = ch;
    var x = c.getContext('2d'); x.drawImage(bmp, 0, 0, cw, ch);
    var img = x.getImageData(0, 0, cw, ch), d = img.data, hist = new Array(256).fill(0), i;
    for (i = 0; i < d.length; i += 4) { var g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0; d[i] = g; hist[g]++; }
    var total = cw * ch, lo = 0, hi = 255, acc = 0;
    for (i = 0; i < 256; i++) { acc += hist[i]; if (acc > total * 0.02) { lo = i; break; } }
    acc = 0; for (i = 255; i >= 0; i--) { acc += hist[i]; if (acc > total * 0.02) { hi = i; break; } }
    var span = Math.max(1, hi - lo);
    var norm = x.createImageData(cw, ch), inv = x.createImageData(cw, ch);
    for (i = 0; i < d.length; i += 4) {
      var v = Math.max(0, Math.min(255, ((d[i] - lo) * 255 / span) | 0));
      norm.data[i] = norm.data[i + 1] = norm.data[i + 2] = v; norm.data[i + 3] = 255;
      inv.data[i] = inv.data[i + 1] = inv.data[i + 2] = 255 - v; inv.data[i + 3] = 255;
    }
    function canvasFrom(data) { var k = document.createElement('canvas'); k.width = cw; k.height = ch; k.getContext('2d').putImageData(data, 0, 0); return k; }
    return [canvasFrom(norm), canvasFrom(inv)];
  }
  function withTimeout(p, ms) { return Promise.race([p, new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout')); }, ms); })]); }

  function readFile(file, lastKnown) {
    return Promise.all([loadTesseract(), bitmapOf(file)]).then(function (a) {
      var T = a[0], vs = variantsOf(a[1]), texts = [];
      return T.createWorker('eng').then(function (worker) {
        return worker.setParameters({ tessedit_char_whitelist: '0123456789.', tessedit_pageseg_mode: '11' }).then(function () {
          var chain = Promise.resolve();
          vs.forEach(function (cv) { chain = chain.then(function () { return withTimeout(worker.recognize(cv), 25000).then(function (r) { texts.push(r.data.text); }).catch(function () {}); }); });
          return chain;
        }).then(function () { return worker.terminate(); }).then(function () { return pickMileage(texts, lastKnown); }, function (e) { try { worker.terminate(); } catch (x) {} throw e; });
      });
    });
  }

  return { pickMileage: pickMileage, candidatesFrom: candidatesFrom, readFile: readFile };
});
