/* Seize — analyse d'un texte : rimes (fin de vers, internes, multisyllabiques), assonances, allitérations. */
(function (root) {
  'use strict';
  var P = root.Phon, D = root.Dict;

  var CLITICS = {};
  ("le la les l' un une des du de d' au aux à a et ou où que qu' qui je j' tu t' il elle on nous vous ils elles me m' te se s' ce c' ça ne n' y en " +
    "mon ton son ma ta sa mes tes ses notre votre leur nos vos leurs dans sur par pour avec sans si est es ai as suis sont ont mais donc car ni " +
    "cette cet ces chez sous the").split(' ').forEach(function (w) { CLITICS[w] = 1; });

  var SECTION_RE = /^\s*(\[[^\]]*\]|#.*)\s*$/;

  function analyze(text, opts) {
    opts = opts || {};
    var rawLines = text.split('\n');
    var lines = [], S = [], allit = [];
    var block = 0, bar = 0, prevBlank = true, verseNo = 0;

    rawLines.forEach(function (lt, li) {
      var line = { text: lt, kind: 'verse', tokens: [], nsyl: 0, block: -1, bar: 0, first: S.length, last: S.length };
      lines.push(line);
      if (!lt.trim()) { line.kind = 'blank'; prevBlank = true; return; }
      if (SECTION_RE.test(lt)) { line.kind = 'section'; prevBlank = true; bar = 0; return; }
      if (prevBlank) { block++; verseNo = 0; prevBlank = false; }
      line.block = block; line.bar = ++bar; line.vn = verseNo++;
      var re = new RegExp(D.WORD_RE.source, 'g'), m;
      while ((m = re.exec(lt))) {
        D.splitToken(m[0]).forEach(function (part) {
          var s = m.index + part.o, raw = part.t, e = D.entry(raw);
          var tok = { s: s, e: s + raw.length, entry: e, clitic: !!CLITICS[e.w], first: S.length };
          var fin = -1;
          e.sylls.forEach(function (sy, k) {
            if (!sy.v) return;
            S.push({
              line: li, block: block, vn: line.vn, tok: line.tokens.length, k: k, cls: sy.cls, on: sy.on, co: sy.co, weak: sy.weak,
              s: s + sy.l0, e: s + sy.l1, word: e.w, clitic: tok.clitic, fin: false, lf: false, rh: 0, as: false, len: 0
            });
            if (!sy.weak) fin = S.length - 1;
            line.nsyl++;
          });
          tok.last = S.length;
          if (tok.last > tok.first) { if (fin < 0) fin = tok.last - 1; S[fin].fin = true; tok.fin = fin; }
          line.tokens.push(tok);
        });
      }
      line.last = S.length;
      // dernière syllabe forte du vers
      for (var q = line.last - 1; q >= line.first; q--) if (S[q].fin) { S[q].lf = true; break; }
    });

    /* ---- Rimes ---- */
    function pair(a, b) {
      var A = S[a], B = S[b];
      if (A.cls !== B.cls) return null;
      var sc = 1, len = 1;
      if (A.co === B.co) sc += A.co ? 1 : 0.5;
      else if (A.co && B.co && (A.co[0] === B.co[0] || A.co[A.co.length - 1] === B.co[B.co.length - 1])) sc += 0.5;
      var oa = A.on.slice(-1), ob = B.on.slice(-1);
      if (oa && oa === ob) sc += 0.5;
      for (var k = 1; k <= 3; k++) {
        var pa = a - k, pb = b - k;
        if (pa < 0 || pb <= a || S[pa].line !== A.line || S[pb].line !== B.line) break;
        if (S[pa].cls !== S[pb].cls) break;
        sc += 1; len++;
        if (S[pa].co === S[pb].co && S[pa].on.slice(-1) === S[pb].on.slice(-1)) sc += 0.25;
      }
      return { sc: sc, len: len };
    }
    function mark(a, len, strong) {
      for (var k = 0; k < len; k++) { var x = S[a - k]; x.rh = Math.max(x.rh, strong ? 2 : 1); }
      S[a].len = Math.max(S[a].len, len);
    }
    var anchors = [];
    for (var i = 0; i < S.length; i++) if (S[i].fin && (S[i].lf || !S[i].clitic)) anchors.push(i);
    for (var x = 0; x < anchors.length; x++) {
      var a = anchors[x], A = S[a];
      for (var y = x + 1; y < anchors.length; y++) {
        var b = anchors[y], B = S[b];
        if (B.block !== A.block) break;
        var dist = B.vn - A.vn;
        if (dist > 4) break;
        var need;
        if (A.lf && B.lf) need = dist <= 1 ? 1 : 1.5;
        else if (A.lf || B.lf) { if (dist > 2) continue; need = 2; }
        else { if (dist > 1 || A.word === B.word) continue; need = 2.5; }   // deux mots en plein vers : il faut plus qu'une voyelle commune
        var pr = pair(a, b);
        if (!pr || pr.sc < need) continue;
        var strong = pr.sc >= 2;
        mark(a, pr.len, strong); mark(b, pr.len, strong);
      }
    }

    /* ---- Assonances : une même voyelle qui revient dans le vers ---- */
    lines.forEach(function (line, li) {
      if (line.kind !== 'verse') return;
      var cnt = {}, n = 0, q;
      for (q = line.first; q < line.last; q++) if (!S[q].weak) { cnt[S[q].cls] = (cnt[S[q].cls] || 0) + 1; n++; }
      var thr = n <= 9 ? 3 : n <= 13 ? 4 : 5;
      var near = {};
      for (var d = -1; d <= 1; d++) {
        var L2 = lines[li + d];
        if (!L2 || L2.kind !== 'verse' || L2.block !== line.block) continue;
        for (q = L2.first; q < L2.last; q++) if (S[q].rh) near[S[q].cls] = 1;
      }
      for (q = line.first; q < line.last; q++) {
        var s = S[q];
        if (s.weak || s.rh) continue;
        if (cnt[s.cls] >= thr || (near[s.cls] && cnt[s.cls] >= 2)) s.as = true;
      }
    });

    /* ---- Allitérations : une même consonne qui attaque plusieurs syllabes du vers ---- */
    lines.forEach(function (line, li) {
      if (line.kind !== 'verse') return;
      var occ = [];
      line.tokens.forEach(function (tok) {
        var e = tok.entry;
        if (!e.sylls.length || !e.sylls.some(function (z) { return z.v; })) {
          var c0 = e.ph && e.ph[0];
          if (c0 && P.CFAM[c0]) occ.push({ fam: P.CFAM[c0], s: tok.s, e: tok.e, init: true });
          return;
        }
        e.sylls.forEach(function (sy, k) {
          var c = sy.ph[0];
          if (!c || !P.CFAM[c]) return;
          var sp = e.spans[sy.p0];
          if (!sp) return;
          occ.push({ fam: P.CFAM[c], s: tok.s + Math.max(sp[0], sy.l0), e: tok.s + Math.min(sp[1], sy.l1), init: k === 0 });
        });
      });
      var by = {};
      occ.forEach(function (o) { (by[o.fam] = by[o.fam] || []).push(o); });
      var thr = line.nsyl <= 9 ? 3 : 4;
      Object.keys(by).forEach(function (fam) {
        var list = by[fam], inits = list.filter(function (o) { return o.init; }).length;
        if (list.length >= thr && inits >= 2) list.forEach(function (o) { if (o.e > o.s) allit.push({ line: li, s: o.s, e: o.e, fam: fam }); });
      });
    });

    return { lines: lines, syl: S, allit: allit };
  }

  /* Découpe un vers en morceaux prêts à afficher : [{t, cls, lvl, fam}]
     level : 'rimes' | 'asso' | 'tout' ; allit : booléen */
  function runs(res, li, level, withAllit) {
    var line = res.lines[li], text = line.text, n = text.length;
    if (line.kind !== 'verse') return [{ t: text }];
    var cls = new Array(n), lvl = new Array(n), fam = new Array(n), sid = new Array(n), tk = new Array(n);
    line.tokens.forEach(function (t, ti) { for (var c = t.s; c < t.e && c < n; c++) tk[c] = ti; });
    for (var q = line.first; q < line.last; q++) {
      var s = res.syl[q], L = 0;
      if (s.rh) L = s.rh + 1;                          // 2 = rime, 3 = rime riche
      else if (!s.weak && (level === 'tout' || (level === 'asso' && s.as))) L = 1;
      if (!L) continue;
      for (var c = s.s; c < s.e && c < n; c++) { cls[c] = s.cls; lvl[c] = L; sid[c] = q; }
    }
    if (withAllit) res.allit.forEach(function (a) { if (a.line === li) for (var c = a.s; c < a.e && c < n; c++) fam[c] = a.fam; });
    var out = [], cur = null;
    for (var i = 0; i < n; i++) {
      if (!cur || cur.cls !== cls[i] || cur.lvl !== lvl[i] || cur.fam !== fam[i] || cur.sid !== sid[i] || cur.tk !== tk[i]) {
        cur = { t: '', cls: cls[i], lvl: lvl[i], fam: fam[i], sid: sid[i], tk: tk[i] }; out.push(cur);
      }
      cur.t += text[i];
    }
    return out;
  }

  root.Rhyme = { analyze: analyze, runs: runs, SECTION_RE: SECTION_RE };
})(typeof window !== 'undefined' ? window : globalThis);
