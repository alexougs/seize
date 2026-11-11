/* Seize — dictionnaire phonétique : chargement, recherche d'un mot, recherche de rimes. */
(function (root) {
  'use strict';
  var P = root.Phon;
  var words = [], sylls = [], flags = null, freq = null, nsyl = null, alias = null;
  var normPh = null, skel = null;         // calculés à la première recherche
  var custom = {};                        // mots perso : mot -> {syll, say}
  var cache = new Map();
  var N = 0;

  var F = { NOM: 1, VER: 2, ADJ: 4, ADV: 8, AUTRE: 16, ARGOT: 32, PROPRE: 64, PERSO: 128 };

  function load(text) {
    var cut = text.indexOf('\n#\n');
    var main = cut >= 0 ? text.slice(0, cut) : text, rest = cut >= 0 ? text.slice(cut + 3) : '';
    var lines = main.split('\n');
    N = lines.length;
    if (!lines[N - 1]) N--;
    words = new Array(N); sylls = new Array(N);
    flags = new Uint8Array(N); freq = new Uint8Array(N); nsyl = new Uint8Array(N);
    for (var i = 0; i < N; i++) {
      var l = lines[i], a = l.indexOf('\t'), b = l.indexOf('\t', a + 1);
      words[i] = l.slice(0, a);
      var sy = l.slice(a + 1, b); sylls[i] = sy;
      var m = l.slice(b + 1);
      flags[i] = parseInt(m.slice(0, -1), 36) || 0;
      freq[i] = m.charCodeAt(m.length - 1) - 48;
      var c = 1; for (var k = 0; k < sy.length; k++) if (sy.charCodeAt(k) === 45) c++;
      nsyl[i] = c;
    }
    alias = new Map();
    rest.split('\n').forEach(function (l) { var t = l.indexOf('\t='); if (t > 0) alias.set(l.slice(0, t), l.slice(t + 2)); });
    normPh = skel = null; cache.clear();
    return N;
  }

  function find(w) {          // premier indice du mot, ou -1
    var lo = 0, hi = N - 1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1, x = words[mid];
      if (x < w) lo = mid + 1; else if (x > w) hi = mid - 1;
      else { while (mid > 0 && words[mid - 1] === w) mid--; return mid; }
    }
    return -1;
  }

  function bare(w) { return w.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
  function clean(w) { return w.toLowerCase().replace(/[’ʼ`´]/g, "'").replace(/œ/g, 'oe').replace(/æ/g, 'ae'); }

  /* Toutes les prononciations connues d'un mot (la plus courante d'abord). */
  function variants(w) {
    w = clean(w);
    var out = [], i = find(w);
    if (i < 0 && alias && alias.has(w)) { w = alias.get(w); i = find(w); }
    for (; i >= 0 && i < N && words[i] === w; i++) out.push({ w: w, syll: sylls[i], flags: flags[i], f: freq[i] });
    return out;
  }

  /* Entrée complète d'un mot : sons, syllabes, lettres de chaque syllabe. */
  function entry(raw) {
    var w = clean(raw);
    var hit = cache.get(w);
    if (hit) return hit;
    var e, c = custom[w];
    if (c) { e = P.entryFromDict(w, c.syll); e.src = 'perso'; }
    else {
      var v = variants(w);
      if (v.length) {
        // les lettres sont celles tapées (etre) même si le mot vient d'un alias (être)
        e = P.entryFromDict(w, v[0].syll); e.src = 'dico'; e.flags = v[0].flags;
        if (v.length > 1) e.alts = v.map(function (x) { return x.syll; });
      } else { e = P.g2p(w); e.src = 'devine'; }
    }
    e.w = w;
    if (cache.size > 20000) cache.clear();
    cache.set(w, e);
    return e;
  }
  /* Même mot, autre prononciation choisie pour un vers précis. */
  function entryWith(raw, syll) {
    var w = clean(raw), key = w + '|' + syll, hit = cache.get(key);
    if (hit) return hit;
    var e = P.entryFromDict(w, syll); e.src = 'choix'; e.w = w;
    cache.set(key, e);
    return e;
  }
  var EXTRA = { tous: ['tu', 'tus'], plus: ['ply', 'plys', 'plyz'], six: ['sis', 'si', 'siz'], dix: ['dis', 'di', 'diz'], huit: ['8it', '8i'],
    fait: ['fE', 'fEt'], but: ['by', 'byt'], sens: ['s@s', 's@'], os: ['Os', 'o'], donc: ['d§k', 'd§'], soit: ['swa', 'swat'], cinq: ['s5k', 's5'], vingt: ['v5', 'v5t'] };
  /* Les façons de dire un mot : homographes (plus, fils), e avalé (p'tit), e final prononcé (peti-te). */
  function alternatives(raw) {
    var w = clean(raw), e = entry(w), out = [], seen = {};
    function add(s) { if (s && !seen[s]) { seen[s] = 1; out.push(s); } }
    add(e.syll);
    (e.alts || []).forEach(add);
    (EXTRA[w] || []).forEach(add);
    var ph = e.syll.replace(/-/g, ''), nv = 0, ns = 0;
    for (var i = 0; i < ph.length; i++) { if (P.isVow(ph[i])) nv++; if (ph[i] === '°') ns++; }
    if (ns && ph.length > ns) add(P.syllabify(ph.replace(/°/g, '')).join('-'));
    if (nv && /[^aeiouyàâéèêëîïôöùûü'\-]e(s|nt)?$/.test(w) && !P.isVow(ph[ph.length - 1])) add(P.syllabify(ph + '°').join('-'));
    return out;
  }
  function known(raw) { var w = clean(raw); return !!custom[w] || variants(w).length > 0; }

  function setCustom(map) { custom = map || {}; cache.clear(); }

  /* Sons d'une expression (un ou plusieurs mots), pour la recherche. */
  var WORD_RE = /[A-Za-zÀ-ÖØ-öø-ÿŒœ]+(?:['’\-][A-Za-zÀ-ÖØ-öø-ÿŒœ]+)*['’]?/g;
  function splitToken(tok) {            // "j'ai" -> ["j'", "ai"] sauf si le dictionnaire connaît l'ensemble
    var w = clean(tok);
    if (!/['\-]/.test(w) || known(w)) return [{ t: tok, o: 0 }];
    var parts = [], re = /[^'\-]+'?/g, m;
    while ((m = re.exec(tok.replace(/[’ʼ]/g, "'")))) parts.push({ t: m[0], o: m.index });
    return parts;
  }
  function phrase(q) {
    var syl = [], m; WORD_RE.lastIndex = 0;
    while ((m = WORD_RE.exec(q))) splitToken(m[0]).forEach(function (p) {
      var e = entry(p.t); if (e.syll) syl.push(e.syll);
    });
    // une consonne isolée (j', l') se colle au mot suivant
    var out = [];
    for (var i = 0; i < syl.length; i++) {
      if (!/[aiyuoOeE°2951@§]/.test(syl[i]) && i + 1 < syl.length) syl[i + 1] = syl[i] + syl[i + 1];
      else out.push(syl[i]);
    }
    return out.join('-');
  }

  function prep() {
    if (normPh) return;
    normPh = new Array(N); skel = new Array(N);
    for (var i = 0; i < N; i++) {
      var n = P.norm(sylls[i].replace(/-/g, ''));
      normPh[i] = n;
      var s = ''; for (var k = 0; k < n.length; k++) if (P.isVow(n[k])) s += n[k];
      skel[i] = s;
    }
  }

  function scoreRime(qn, minL, pn) {
    var a = qn.length - 1, b = pn.length - 1, L = 0, nv = 0;
    while (a >= 0 && b >= 0 && qn.charCodeAt(a) === pn.charCodeAt(b)) { if (P.isVow(qn[a])) nv++; L++; a--; b--; }
    return L >= minL ? nv * 100 + L : 0;
  }
  function scoreAsso(qs, ps) {
    var a = qs.length - 1, b = ps.length - 1, nv = 0;
    while (a >= 0 && b >= 0 && qs.charCodeAt(a) === ps.charCodeAt(b)) { nv++; a--; b--; }
    return nv * 100;
  }

  /* opts : mode 'rime' | 'asso', nsyl (0 = tout, 5 = 5 et +), pos (masque), freq (seuil 0-9), argot, limit */
  function search(query, opts) {
    opts = opts || {};
    var qsyll = opts.syll || phrase(query);
    var qn = P.norm(qsyll.replace(/-/g, ''));
    var lastV = -1, qs = '', i;
    for (i = 0; i < qn.length; i++) if (P.isVow(qn[i])) { lastV = i; qs += qn[i]; }
    if (lastV < 0) return { syll: qsyll, groups: [], total: 0 };
    prep();
    var minL = qn.length - lastV, asso = opts.mode === 'asso';
    var qwords = {}, qlast = '';
    (clean(query).match(/[a-zà-öø-ÿ'\-]+/g) || []).forEach(function (w) { qwords[w] = 1; qlast = w; });
    var qstem = bare(qlast).slice(0, 3), qfull = P.norm(phrase(qlast).replace(/-/g, ''));
    var res = [];
    function consider(w, sy, fl, fr, ns, pn, ps) {
      if (qwords[w]) return;
      if (pn === qfull && bare(w).slice(0, 3) === qstem) return;      // même mot au pluriel, conjugué…
      if (opts.nsyl && (opts.nsyl >= 5 ? ns < 5 : ns !== opts.nsyl)) return;
      if (opts.pos && !(fl & opts.pos)) return;
      if (opts.freq && fr < opts.freq && !(fl & F.PERSO)) return;
      if (opts.argot && !(fl & (F.ARGOT | F.PERSO))) return;
      var sc = asso ? scoreAsso(qs, ps) : scoreRime(qn, minL, pn);
      if (!sc) return;
      if (asso) {               // à voyelles égales, on préfère les consonnes qui se ressemblent
        var a = qn.length - 1, b = pn.length - 1, same = 0;
        while (a >= 0 && b >= 0 && qn.charCodeAt(a) === pn.charCodeAt(b)) { same++; a--; b--; }
        sc += Math.min(same, 9);
      }
      res.push({ w: w, syll: sy, flags: fl, f: fr, n: ns, sc: sc });
    }
    for (i = 0; i < N; i++) consider(words[i], sylls[i], flags[i], freq[i], nsyl[i], normPh[i], skel[i]);
    Object.keys(custom).forEach(function (w) {
      var sy = custom[w].syll, pn = P.norm(sy.replace(/-/g, '')), ps = '';
      for (var k = 0; k < pn.length; k++) if (P.isVow(pn[k])) ps += pn[k];
      consider(w, sy, F.PERSO, 9, sy.split('-').length, pn, ps);
    });
    res.sort(function (x, y) {
      var gx = Math.floor(x.sc / 100), gy = Math.floor(y.sc / 100);
      if (gx !== gy) return gy - gx;
      var rx = x.sc % 100, ry = y.sc % 100;
      // richesse d'abord, puis mots courants ; les formes très rares passent derrière
      var kx = rx * 10 + x.f - (x.f === 0 ? 15 : 0) - (x.flags === 16 ? 6 : 0);
      var ky = ry * 10 + y.f - (y.f === 0 ? 15 : 0) - (y.flags === 16 ? 6 : 0);
      if (kx !== ky) return ky - kx;
      return x.w < y.w ? -1 : 1;
    });
    // un mot = une ligne (plusieurs prononciations ou natures possibles)
    var seen = {}, groups = [], cur = null, total = 0, limit = opts.limit || 300;
    for (i = 0; i < res.length; i++) {
      var r = res[i];
      if (seen[r.w]) continue; seen[r.w] = 1;
      total++;
      if (total > limit) continue;
      var nv = Math.floor(r.sc / 100);
      if (!cur || cur.nv !== nv) { cur = { nv: nv, items: [] }; groups.push(cur); }
      cur.items.push(r);
    }
    return { syll: qsyll, groups: groups, total: total, minL: minL };
  }

  /* Rime en deux mots : on coupe le son cherché en deux et on propose une liste pour chaque moitié. */
  function twoWords(query, opts) {
    opts = opts || {};
    var qsyll = opts.syll || phrase(query);
    var parts = qsyll.split('-').map(P.norm).filter(function (p) { return /[aiyuoE25@§]/.test(p); });
    var k = parts.length, out = { syll: qsyll, splits: [] };
    if (k < 2 || k > 6) return out;
    prep();
    var minF = Math.max(opts.freq || 0, 3);
    var qwords = {}; (clean(query).match(/[a-zà-öø-ÿ'\-]+/g) || []).forEach(function (w) { qwords[w] = 1; });
    function vow(s) { var o = ''; for (var i = 0; i < s.length; i++) if (P.isVow(s[i])) o += s[i]; return o; }
    function same(a, b) { var x = a.length - 1, y = b.length - 1, n = 0; while (x >= 0 && y >= 0 && a.charCodeAt(x) === b.charCodeAt(y)) { n++; x--; y--; } return n; }
    for (var s = 1; s < k; s++) {
      var left = parts.slice(0, s).join(''), right = parts.slice(s).join('');
      var lsk = vow(left), rsk = vow(right);
      var fv = 0; while (fv < right.length && !P.isVow(right[fv])) fv++;
      var tail = right.slice(fv);
      var A = [], B = [];
      for (var i = 0; i < N; i++) {
        if (freq[i] < minF || (flags[i] & F.PROPRE) || qwords[words[i]]) continue;
        if (words[i].length === 1 && 'aàyô'.indexOf(words[i]) < 0) continue;          // noms de lettres
        var pn = normPh[i];
        if (nsyl[i] === k - s && skel[i] === rsk && pn.length >= tail.length && pn.slice(pn.length - tail.length) === tail)
          B.push({ w: words[i], syll: sylls[i], flags: flags[i], f: freq[i], sc: same(right, pn) * 10 + freq[i] });
        if (nsyl[i] === s && skel[i] === lsk)
          A.push({ w: words[i], syll: sylls[i], flags: flags[i], f: freq[i], sc: same(left, pn) * 10 + freq[i] - (flags[i] === 16 ? 4 : 0) });
      }
      var top = function (arr) {
        var seen = {};
        return arr.sort(function (x, y) { return y.sc - x.sc || (x.w < y.w ? -1 : 1); })
          .filter(function (r) { if (seen[r.w]) return false; seen[r.w] = 1; return true; }).slice(0, opts.limit || 36);
      };
      A = top(A); B = top(B);
      if (A.length && B.length) out.splits.push({ left: s, right: k - s, a: A, b: B });
    }
    return out;
  }

  root.Dict = {
    entryWith: entryWith, alternatives: alternatives, twoWords: twoWords,
    F: F, load: load, variants: variants, entry: entry, known: known, setCustom: setCustom,
    phrase: phrase, search: search, splitToken: splitToken, WORD_RE: WORD_RE, clean: clean,
    size: function () { return N; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
