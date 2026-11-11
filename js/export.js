/* Seize — exports : texte brut, PDF (avec ou sans couleurs), sauvegarde complète. */
(function (root) {
  'use strict';
  var P = root.Phon;

  /* Remet le fichier à la personne, selon ce que l'endroit permet. */
  function deliver(filename, data, mime) {
    var blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    var viaClaude = root.claude && typeof root.claude.use === 'function' ? root.claude.use('downloads') : Promise.resolve(null);
    return Promise.resolve(viaClaude).then(function (dl) {
      if (dl) return dl.save({ filename: filename, data: blob }).then(function () { return 'ok'; }, function (e) {
        if (e && e.code === 'declined') return 'cancel';
        throw e;
      });
      var touch = root.matchMedia && root.matchMedia('(pointer: coarse)').matches;
      if (touch && navigator.canShare) {
        try {
          var file = new File([blob], filename, { type: mime });
          if (navigator.canShare({ files: [file] })) {
            return navigator.share({ files: [file], title: filename }).then(function () { return 'ok'; }, function (e) {
              if (e && e.name === 'AbortError') return 'cancel';
              return anchor(blob, filename);
            });
          }
        } catch (e) { /* on continue */ }
      }
      return anchor(blob, filename);
    });
  }
  function anchor(blob, filename) {
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 4000);
    return 'ok';
  }

  function slug(title) {
    var s = (title || 'texte').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
    return s || 'texte';
  }

  var jspdfLoading = null;
  function loadJsPdf() {
    if (root.jspdf) return Promise.resolve(root.jspdf);
    function tag(src) {
      return new Promise(function (res, rej) {
        var s = document.createElement('script'); s.src = src;
        s.onload = function () { if (root.jspdf) res(root.jspdf); else rej(new Error('pdf')); }; s.onerror = function () { rej(new Error('pdf')); };
        document.head.appendChild(s);
      });
    }
    // copie locale (hors ligne) ; sinon la même version depuis le CDN
    if (!jspdfLoading) jspdfLoading = tag('vendor/jspdf.umd.min.js').catch(function () {
      return tag('https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js');
    }).catch(function (e) { jspdfLoading = null; throw e; });
    return jspdfLoading;
  }

  /* Les polices standard d'un PDF ne connaissent que le latin de base. */
  function pdfSafe(t) {
    return t.replace(/[’‘ʼ]/g, "'").replace(/[“”«»]/g, function (c) { return c === '«' || c === '»' ? c : '"'; })
      .replace(/…/g, '...').replace(/[–—]/g, '-').replace(/œ/g, 'oe').replace(/Œ/g, 'OE').replace(/ /g, ' ')
      .replace(/[^\x09\x20-\x7e\xa1-\xff]/g, '');
  }
  function hex(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }

  var FILL = { a: '#ff9e94', e: '#ffbe6e', i: '#fce85a', an: '#a9e67f', u: '#74e0cc', o: '#8ccbff', ou: '#c8b3ff', on: '#f7a3dd', eu: '#dfc29c', 'in': '#3a4254' };
  var LINE = { a: '#d93a2b', e: '#cf7a00', i: '#a89000', an: '#3c9a12', u: '#0a8f7b', o: '#1877c9', ou: '#7448e0', on: '#c23aa0', eu: '#8f6a3a', 'in': '#3a4254' };
  var FAMC = { p: 'a', t: 'o', k: 'an', f: 'ou', s: 'e', ch: 'on', m: 'u', n: 'eu', l: 'i', r: 'in' };

  /* buildPdf(jsPDF, {title, text, colors, level, allit}) -> jsPDF doc */
  function buildPdf(jspdf, o) {
    var doc = new jspdf.jsPDF({ unit: 'mm', format: 'a4' });
    var M = 20, W = 210 - 2 * M, y = 24, LH = 7.4, FS = 11.5;
    var res = o.colors ? root.Rhyme.analyze(o.text, o.analyzeOpts) : null;
    function page() { if (y > 297 - 20) { doc.addPage(); y = 22; } }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(20, 23, 29);
    doc.splitTextToSize(pdfSafe(o.title || 'Sans titre'), W).forEach(function (l) { doc.text(l, M, y); y += 9; });
    y += 3;

    var used = {}, usedFam = {};
    var lines = o.text.split('\n');
    lines.forEach(function (raw, li) {
      if (!raw.trim()) { y += LH * 0.6; return; }
      var isSection = root.Rhyme.SECTION_RE.test(raw);
      if (isSection) {
        y += 2; page();
        doc.setFont('helvetica', 'bold'); doc.setFontSize(FS); doc.setTextColor(36, 64, 216);
        doc.text(pdfSafe(raw.trim()), M, y); y += LH; return;
      }
      var runs = res ? root.Rhyme.runs(res, li, o.level || 'rimes', !!o.allit) : [{ t: raw }];
      // on ne coupe jamais au milieu d'un mot : le mot entier passe à la ligne
      var x = M, items = [], wrapped = false;
      page();
      runs.forEach(function (r) {
        var bold = r.lvl >= 2 || !!r.fam;
        pdfSafe(r.t).split(/( +)/).forEach(function (pc) {
          if (!pc) return;
          doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(FS);
          items.push({ t: pc, r: r, bold: bold, sp: !pc.trim(), w: doc.getTextWidth(pc) });
        });
      });
      items.forEach(function (it, n) {
        if (!it.sp && (n === 0 || items[n - 1].sp)) {
          var ww = 0; for (var q = n; q < items.length && !items[q].sp; q++) ww += items[q].w;
          if (x + ww > M + W && x > M + 6) { x = M + 6; y += LH; page(); wrapped = true; }
        }
        if (it.sp) { if (!wrapped) x += it.w; return; }
        wrapped = false;
        var r = it.r, w = it.w;
        if (r.lvl >= 2) {
          var f = hex(FILL[r.cls]); doc.setFillColor(f[0], f[1], f[2]);
          doc.rect(x - 0.15, y - 4.3, w + 0.3, 5.7, 'F'); used[r.cls] = 1;
        } else if (r.lvl === 1) {
          var k = hex(LINE[r.cls]); doc.setDrawColor(k[0], k[1], k[2]); doc.setLineWidth(0.7);
          doc.line(x, y + 1.15, x + w, y + 1.15); used[r.cls] = 1;
        }
        if (r.fam) {
          var c = hex(LINE[FAMC[r.fam]]); doc.setDrawColor(c[0], c[1], c[2]); doc.setLineWidth(0.7);
          doc.line(x, y - 4.45, x + w, y - 4.45); usedFam[r.fam] = 1;
        }
        doc.setFont('helvetica', it.bold ? 'bold' : 'normal'); doc.setFontSize(FS);
        if (r.lvl >= 2 && r.cls === 'in') doc.setTextColor(255, 255, 255); else doc.setTextColor(20, 23, 29);
        doc.text(it.t, x, y);
        x += w;
      });
      y += LH;
    });

    if (o.colors) {                       // légende des sons
      var keys = P.CLASSES.filter(function (c) { return used[c]; });
      if (keys.length) {
        y += 6; page();
        var x2 = M; doc.setFontSize(8.5); doc.setFont('helvetica', 'bold');
        keys.forEach(function (c) {
          var label = P.CLASS_LABEL[c].replace(/ · /g, ' / '), w = doc.getTextWidth(label) + 4;
          if (x2 + w > M + W) { x2 = M; y += 6.5; page(); }
          var f = hex(FILL[c]); doc.setFillColor(f[0], f[1], f[2]); doc.rect(x2, y - 3.5, w, 5, 'F');
          if (c === 'in') doc.setTextColor(255, 255, 255); else doc.setTextColor(20, 23, 29);
          doc.text(label, x2 + 2, y); x2 += w + 2;
        });
      }
    }
    return doc;
  }

  function exportPdf(o) {
    return loadJsPdf().then(function (jspdf) {
      var doc = buildPdf(jspdf, o);
      return deliver(slug(o.title) + (o.colors ? '-rimes' : '') + '.pdf', doc.output('blob'), 'application/pdf');
    });
  }
  function exportTxt(o) {
    var body = (o.title ? o.title + '\n\n' : '') + o.text + '\n';
    return deliver(slug(o.title) + '.txt', body, 'text/plain;charset=utf-8');
  }
  function exportBackup(obj) {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return deliver('seize-sauvegarde-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '.json', JSON.stringify(obj), 'application/json');
  }

  root.Exporter = { pdf: exportPdf, txt: exportTxt, backup: exportBackup, buildPdf: buildPdf, slug: slug };
})(typeof window !== 'undefined' ? window : globalThis);
