/* Seize — moteur phonétique (prononciation, syllabes, rimes).
   Code des sons = celui de Lexique : a i y(u) u(ou) o O e(é) E(è) °(e muet) 2 9 (eu)
   5(in) 1(un) @(an) §(on) · j 8(ui) w · p b t d k g f v s z S(ch) Z(j) m n N(gn) G(ng) l R */
(function (root) {
  'use strict';

  var VOW = 'aiyuoOeE°2951@§';
  var SEMI = 'j8w';
  var OBS = 'pbtdkgfv';
  function isVow(c) { return c !== undefined && c !== '' && VOW.indexOf(c) >= 0; }

  /* Classe de voyelle = une couleur. Tolérance « rap » : é/è, o ouvert/fermé, eu/e, in/un confondus. */
  var CLS = { a: 'a', e: 'e', E: 'e', i: 'i', o: 'o', O: 'o', y: 'u', u: 'ou', '2': 'eu', '9': 'eu', '°': 'eu', '5': 'in', '1': 'in', '@': 'an', '§': 'on' };
  var CLASSES = ['a', 'e', 'i', 'o', 'u', 'ou', 'eu', 'an', 'on', 'in'];
  var CLASS_LABEL = { a: 'a', e: 'é · è', i: 'i', o: 'o', u: 'u', ou: 'ou', eu: 'eu · e', an: 'an', on: 'on', 'in': 'in · un' };

  /* Familles de consonnes pour les allitérations. */
  var CFAM = { p: 'p', b: 'p', t: 't', d: 't', k: 'k', g: 'k', G: 'k', f: 'f', v: 'f', s: 's', z: 's', S: 'ch', Z: 'ch', m: 'm', n: 'n', N: 'n', l: 'l', R: 'r' };
  var CFAMS = ['p', 't', 'k', 'f', 's', 'ch', 'm', 'n', 'l', 'r'];
  var CFAM_LABEL = { p: 'p · b', t: 't · d', k: 'k · g', f: 'f · v', s: 's · z', ch: 'ch · j', m: 'm', n: 'n · gn', l: 'l', r: 'r' };

  var NORM = { e: 'E', E: 'E', o: 'o', O: 'o', '2': '2', '9': '2', '°': '2', '5': '5', '1': '5', G: 'g', x: 'R', r: 'R' };
  function norm(ph) {
    var s = '';
    for (var i = 0; i < ph.length; i++) { var c = ph[i]; s += NORM[c] || c; }
    return s;
  }

  /* Écriture lisible d'un son, pour montrer ce que l'app a compris. */
  var READ = { a: 'a', i: 'i', y: 'u', u: 'ou', o: 'o', O: 'o', e: 'é', E: 'è', '°': 'e', '2': 'eu', '9': 'eu', '5': 'in', '1': 'un', '@': 'an', '§': 'on', j: 'y', '8': 'u', w: 'w', S: 'ch', Z: 'j', N: 'gn', G: 'ng', R: 'r', k: 'k', g: 'g', s: 's', z: 'z', x: 'r' };
  function readable(syll) {
    return syll.split('-').map(function (s) {
      var o = '';
      for (var i = 0; i < s.length; i++) o += READ[s[i]] || s[i];
      return o;
    }).join('·');
  }

  /* ---------- Syllabes ---------- */
  function syllabify(ph) {
    var n = ph.length, nuc = [], i;
    for (i = 0; i < n; i++) if (isVow(ph[i])) nuc.push(i);
    if (nuc.length < 2) return [ph];
    var cuts = [0];
    for (var k = 0; k < nuc.length - 1; k++) {
      var a = nuc[k], b = nuc[k + 1], m = b - a - 1, on;
      if (m <= 1) on = m;
      else {
        var last = ph[b - 1], prev = ph[b - 2];
        on = 1;
        if (SEMI.indexOf(last) >= 0) {
          on = 2;
          if (m >= 3 && 'lR'.indexOf(prev) >= 0 && OBS.indexOf(ph[b - 3]) >= 0) on = 3;
        } else if ('lR'.indexOf(last) >= 0 && OBS.indexOf(prev) >= 0) on = 2;
      }
      cuts.push(b - on);
    }
    var out = [];
    for (i = 0; i < cuts.length; i++) out.push(ph.slice(cuts[i], i + 1 < cuts.length ? cuts[i + 1] : n));
    return out;
  }

  /* ---------- Lettres -> sons (mots absents du dictionnaire) ---------- */
  var VL = 'aàâäeéèêëiîïoôöuùûüyœæ';
  function isVL(c) { return c !== undefined && c !== '' && VL.indexOf(c) >= 0; }
  function isCL(c) { return c !== undefined && c !== '' && c >= 'a' && c <= 'z' && VL.indexOf(c) < 0 || c === 'ç' || c === 'ñ'; }
  var SOFT = 'eéèêëiîïyœæ';

  function g2p(w) {
    var s = w, n = s.length, segs = [];
    function emit(l0, l1, p) { segs.push({ l0: l0, l1: l1, p: p }); }
    function at(i, str) { return s.substr(i, str.length) === str; }

    /* fin de mot : lettres muettes et terminaisons */
    var e0 = n, forced = null;
    while (e0 > 0 && !/[a-zàâäçéèêëîïôöùûüÿœæñ]/.test(s[e0 - 1])) e0--;
    var wend = e0;
    if (e0 > 2 && s[e0 - 1] === 's' && s[e0 - 2] !== 's') e0--;
    else if (e0 > 2 && s[e0 - 1] === 'x' && s[e0 - 2] === 'u') e0--;
    var t = s.slice(0, e0), scanEnd = e0;
    function hasVowelBefore(k) { for (var q = 0; q < k; q++) if (isVL(s[q])) return true; return false; }
    if (/ent$/.test(t) && !/ment$/.test(t) && !/ient$/.test(t) && t.length > 4 && hasVowelBefore(e0 - 3)) scanEnd = e0 - 3;
    else if (/ing$/.test(t) && t.length > 3) { scanEnd = e0 - 3; forced = [[e0 - 3, e0 - 2, 'i'], [e0 - 2, e0, 'G']]; }
    else if (/er$/.test(t) && t.length >= 4) { scanEnd = e0 - 2; forced = [[e0 - 2, e0, 'e']]; }
    else if (/ez$/.test(t) && t.length >= 3) { scanEnd = e0 - 2; forced = [[e0 - 2, e0, 'e']]; }
    else if (/ied$/.test(t)) { scanEnd = e0 - 2; forced = [[e0 - 2, e0, 'e']]; }
    else if (/et$/.test(t) && t.length >= 3) { scanEnd = e0 - 2; forced = [[e0 - 2, e0, 'E']]; }
    else if (/[^aàâeéèêiîïoôuùûy]e$/.test(t) && hasVowelBefore(e0 - 1)) scanEnd = e0 - 1;
    else if (/[aàâeéèêiîïoôuùûy]e$/.test(t) && e0 >= 3) scanEnd = e0 - 1;
    else if (/[nr]t$/.test(t) || /[aàâeéèêiîïoôuùûy][iuîû]t$/.test(t) || /[aâoôêèé]t$/.test(t)) scanEnd = e0 - 1;
    else if (/[nr]d$/.test(t) || /(au|oi)d$/.test(t)) scanEnd = e0 - 1;
    else if (/nc$/.test(t) || /mp$/.test(t) || /oup$/.test(t)) scanEnd = e0 - 1;
    else if (/[ao]ng$/.test(t)) scanEnd = e0 - 1;

    function nasalOK(j) {
      if (j >= wend) return true;
      var c = s[j];
      if (isVL(c) || c === 'n' || c === 'm') return false;
      return true;
    }
    function pron(j) { return j < (forced ? e0 : scanEnd); }           // lettre prononcée ?
    function vowelNext(j) { return j < wend && isVL(s[j]); } // voyelle écrite (même muette)

    var i = 0;
    while (i < scanEnd) {
      var c = s[i], c1 = s[i + 1], c2 = s[i + 2], prev = i > 0 ? s[i - 1] : '';
      var L = 1, P = null;
      switch (c) {
        case 'a': case 'à': case 'â': case 'ä':
          if ((at(i, 'ain') || at(i, 'aim')) && nasalOK(i + 3)) { L = 3; P = '5'; }
          else if (at(i, 'aill')) { L = 4; P = 'aj'; }
          else if (at(i, 'ail') && i + 3 >= e0) { L = 3; P = 'aj'; }
          else if (c1 === 'i' || c1 === 'î') { L = 2; P = 'E'; }
          else if (c1 === 'u') { L = 2; P = 'o'; }
          else if (c1 === 'y') { L = 2; P = vowelNext(i + 2) && pron(i + 2) ? 'Ej' : 'E'; }
          else if ((c1 === 'n' || c1 === 'm') && nasalOK(i + 2)) { L = 2; P = '@'; }
          else P = 'a';
          break;
        case 'e':
          if (at(i, 'eau')) { L = 3; P = 'o'; }
          else if ((at(i, 'ein') || at(i, 'eim')) && nasalOK(i + 3)) { L = 3; P = '5'; }
          else if (at(i, 'euill')) { L = 5; P = '9j'; }
          else if (at(i, 'euil')) { L = 4; P = '9j'; }
          else if (at(i, 'eill')) { L = 4; P = 'Ej'; }
          else if (at(i, 'eil') && i + 3 >= e0) { L = 3; P = 'Ej'; }
          else if (c1 === 'i' || c1 === 'y') { L = 2; P = 'E'; }
          else if (c1 === 'u' || c1 === 'û') { L = 2; P = (pron(i + 2) && 'rlfvnpbg'.indexOf(c2) >= 0) ? '9' : '2'; }
          else if (c1 === 'e' || c1 === 'a') { L = 2; P = 'i'; }
          else if ((c1 === 'n' || c1 === 'm') && nasalOK(i + 2)) { L = 2; P = (prev === 'i' || prev === 'y' || prev === 'é') ? '5' : '@'; }
          else if (!pron(i + 1)) P = '°';
          else if (c1 === 'x') P = 'E';
          else if (isCL(c1) && c1 === c2) P = 'E';
          else if (isCL(c1) && isCL(c2) && !(OBS.indexOf(c1) >= 0 && (c2 === 'l' || c2 === 'r')) &&
            !/^(ch|ph|th|gn|qu|sh)$/.test(c1 + c2) && c2 !== 'h') P = 'E';
          else if (isCL(c1) && !pron(i + 2)) P = 'E';
          else if (isCL(c1) && /^(ch|ph|th|gn|sh)$/.test(c1 + c2) && !pron(i + 3)) P = 'E';
          else P = (i === 0) ? 'e' : '°';
          break;
        case 'é': P = 'e'; break;
        case 'è': case 'ê': case 'ë': P = 'E'; break;
        case 'i': case 'î':
          if (at(i, 'ill') && i > 0 && pron(i + 2)) { L = 3; P = 'ij'; }
          else if ((c1 === 'n' || c1 === 'm') && nasalOK(i + 2)) { L = 2; P = '5'; }
          else if (pron(i + 1) && isVL(c1)) P = (i >= 2 && OBS.indexOf(s[i - 2]) >= 0 && (prev === 'l' || prev === 'r')) ? 'ij' : 'j';
          else P = 'i';
          break;
        case 'ï':
          P = (isVL(prev) && pron(i + 1) && isVL(c1)) ? 'j' : 'i';
          break;
        case 'o': case 'ô': case 'ö':
          if (at(i, 'oin') && nasalOK(i + 3)) { L = 3; P = 'w5'; }
          else if (c1 === 'i' || c1 === 'î') { L = 2; P = 'wa'; }
          else if (c1 === 'y') { L = 2; P = (vowelNext(i + 2) && pron(i + 2)) ? 'waj' : 'Oj'; }
          else if (at(i, 'ouill')) { L = 5; P = 'uj'; }
          else if (at(i, 'ouil') && i + 4 >= e0) { L = 4; P = 'uj'; }
          else if (c1 === 'u' || c1 === 'ù' || c1 === 'û') { L = 2; P = (pron(i + 2) && isVL(c2)) ? 'w' : 'u'; }
          else if (c1 === 'o') { L = 2; P = 'u'; }
          else if (c1 === 'w' && i + 2 >= scanEnd) { L = 2; P = 'o'; }
          else if ((c1 === 'n' || c1 === 'm') && nasalOK(i + 2)) { L = 2; P = '§'; }
          else if (c === 'ô' || !pron(i + 1) || (c1 === 's' && vowelNext(i + 2))) P = 'o';
          else P = 'O';
          break;
        case 'œ':
          if (c1 === 'u') { L = 2; P = (pron(i + 2) && 'rlfvnpbg'.indexOf(c2) >= 0) ? '9' : '2'; }
          else if (at(i, 'œil')) { L = 3; P = '9j'; }
          else P = '9';
          break;
        case 'æ': P = 'e'; break;
        case 'u': case 'ù': case 'û': case 'ü':
          if (at(i, 'ueill')) { L = 5; P = '9j'; }
          else if (at(i, 'ueil')) { L = 4; P = '9j'; }
          else if ((c1 === 'n' || c1 === 'm') && nasalOK(i + 2)) { L = 2; P = '1'; }
          else if (pron(i + 1) && isVL(c1)) P = '8';
          else P = 'y';
          break;
        case 'y':
          if ((c1 === 'n' || c1 === 'm') && nasalOK(i + 2)) { L = 2; P = '5'; }
          else if (pron(i + 1) && isVL(c1)) P = 'j';
          else P = 'i';
          break;
        case 'b': if (c1 === 'b') L = 2; P = (c1 === 's' || c1 === 't') ? 'p' : 'b'; break;
        case 'c':
          if (c1 === 'h') { L = 2; P = (c2 === 'r' || c2 === 'l') ? 'k' : 'S'; }
          else if (c1 === 'k') { L = 2; P = 'k'; }
          else if (at(i, 'cqu')) { L = 3; P = 'k'; }
          else if (c1 === 'q') { L = 2; P = 'k'; }
          else if (c1 === 'c') { L = 2; P = SOFT.indexOf(c2) >= 0 && c2 ? 'ks' : 'k'; }
          else P = (c1 && SOFT.indexOf(c1) >= 0) ? 's' : 'k';
          break;
        case 'ç': P = 's'; break;
        case 'd': if (c1 === 'd') L = 2; P = 'd'; break;
        case 'f': if (c1 === 'f') L = 2; P = 'f'; break;
        case 'g':
          if (c1 === 'n') { L = 2; P = 'N'; }
          else if (c1 === 'u' && c2 && SOFT.indexOf(c2) >= 0) { L = 2; P = 'g'; }
          else if (c1 === 'e' && c2 && 'aâoôu'.indexOf(c2) >= 0) { L = 2; P = 'Z'; }
          else if (c1 === 'g') { L = 2; P = 'g'; }
          else P = (c1 && SOFT.indexOf(c1) >= 0) ? 'Z' : 'g';
          break;
        case 'h': P = ''; break;
        case 'j': P = 'Z'; break;
        case 'k': if (c1 === 'k') L = 2; else if (c1 === 'h') { L = 2; P = 'R'; break; } P = 'k'; break;
        case 'l': if (c1 === 'l') L = 2; P = 'l'; break;
        case 'm': if (c1 === 'm') L = 2; P = 'm'; break;
        case 'n': if (c1 === 'n') L = 2; P = 'n'; break;
        case 'ñ': P = 'N'; break;
        case 'p': if (c1 === 'h') { L = 2; P = 'f'; } else { if (c1 === 'p') L = 2; P = 'p'; } break;
        case 'q': if (c1 === 'u') L = 2; P = 'k'; break;
        case 'r': if (c1 === 'r' || c1 === 'h') L = 2; P = 'R'; break;
        case 's':
          if (at(i, 'sch')) { L = 3; P = 'S'; }
          else if (c1 === 'h') { L = 2; P = 'S'; }
          else if (c1 === 's') { L = 2; P = 's'; }
          else if (c1 === 'c' && c2 && SOFT.indexOf(c2) >= 0) { L = 2; P = 's'; }
          else P = (isVL(prev) && vowelNext(i + 1)) ? 'z' : 's';
          break;
        case 't':
          if (at(i, 'tch')) { L = 3; P = 'tS'; }
          else if (c1 === 'h') { L = 2; P = 't'; }
          else if (c1 === 't') { L = 2; P = 't'; }
          else if (prev !== 's' && (at(i, 'tion') || at(i, 'tiel') || at(i, 'tieu') || at(i, 'tial') || at(i, 'tiaux'))) P = 's';
          else P = 't';
          break;
        case 'v': P = 'v'; break;
        case 'w': if (c1 === 'h') L = 2; P = 'w'; break;
        case 'x': P = (i === 1 && s[0] === 'e' && vowelNext(2)) ? 'gz' : 'ks'; break;
        case 'z': if (c1 === 'z') L = 2; P = 'z'; break;
        default: P = '';
      }
      if (i + L > scanEnd) L = scanEnd - i;
      emit(i, i + L, P);
      i += L;
    }
    if (forced) for (var f = 0; f < forced.length; f++) emit(forced[f][0], forced[f][1], forced[f][2]);
    var lastL = segs.length ? segs[segs.length - 1].l1 : 0;
    if (lastL < n) emit(lastL, n, '');
    return finishSegs(w, segs, null);
  }

  /* ---------- Alignement lettres <-> sons (mots du dictionnaire) ---------- */
  var GT = {};
  (function () {
    var T = [
      'a:a,e,E', 'à:a', 'â:a', 'ä:a,E', 'ai:E,e,°', 'aî:E,e', 'ay:Ej,ej,E,e,ei,aj', 'au:o,O', 'eau:o', 'an:@', 'am:@', 'en:@,5,En', 'em:@,5', 'aon:@', 'aen:@',
      'in:5', 'im:5', 'ain:5', 'aim:5', 'ein:5', 'yn:5', 'ym:5', 'în:5', 'un:1,5,§', 'um:1,5,Om', 'on:§', 'om:§', 'ou:u,w', 'où:u', 'oû:u', 'aou:u', 'aoû:u', 'oo:u,o,O,oO',
      'oi:wa', 'oî:wa', 'oy:waj,wa,Oj', 'oin:w5', 'oê:wa', 'oe:wa,9,2,e,oE', 'oë:OE,wE', 'eu:2,9,y', 'eû:2,y', 'œu:2,9', 'œ:9,2,e', 'oeu:9,2', 'ue:9', 'æ:e',
      'e:°,E,e,a,2,9', 'é:e,E', 'è:E,e', 'ê:E,e', 'ë:E,e', 'ei:E,e', 'ey:E,e,Ej', 'ee:i', 'ea:i', 'i:i,j,ij', 'î:i', 'ï:i,j', 'o:o,O', 'ô:o,O', 'ö:o,9,2',
      'u:y,8,u,9,O,w', 'û:y', 'ù:y', 'ü:y', 'y:i,j,ij', 'ill:j,ij', 'il:j', 'ïe:j',
      'b:b,p', 'bb:b', 'c:k,s,g', 'cc:k,ks', 'ç:s', 'ch:S,k,tS', 'sch:S', 'sh:S', 'tch:tS', 'ck:k', 'cqu:k', 'cq:k', 'd:d,t', 'dd:d', 'f:f,v', 'ff:f',
      'g:g,Z,k', 'gg:g,gZ', 'ge:Z', 'gu:g,g8,gw', 'gn:N,gn', 'h:', 'j:Z,dZ,j,R', 'k:k', 'kk:k', 'l:l', 'll:l,j', 'm:m', 'mm:m', 'n:n', 'nn:n', 'ng:G', 'ñ:N',
      'p:p', 'pp:p', 'ph:f', 'q:k', 'qu:k,kw,k8', 'r:R', 'rr:R', 'rh:R', 's:s,z', 'ss:s', 'sc:s,sk', 't:t,s', 'tt:t', 'th:t', 'v:v', 'w:w,v', 'wh:w',
      'x:ks,gz,s,z,k', 'z:z,s', 'zz:z,dz,ts'
    ];
    T.forEach(function (r) { var k = r.split(':'); GT[k[0]] = k[1].split(','); });
  })();

  function align(w, ph) {
    var n = w.length, m = ph.length, W = m + 1, INF = 1e9;
    var cost = new Float32Array((n + 1) * W), back = new Array((n + 1) * W);
    for (var q = 0; q < cost.length; q++) cost[q] = INF;
    cost[0] = 0;
    for (var i = 0; i <= n; i++) {
      for (var j = 0; j <= m; j++) {
        var c0 = cost[i * W + j];
        if (c0 >= INF) continue;
        // graphèmes connus (du plus long au plus court)
        for (var L = Math.min(4, n - i); L >= 1; L--) {
          var opts = GT[w.substr(i, L)];
          if (!opts) continue;
          for (var o = 0; o < opts.length; o++) {
            var p = opts[o], pl = p.length;
            if (pl === 0 || ph.substr(j, pl) !== p) continue;
            var idx = (i + L) * W + j + pl, cc = c0 + o * 0.01;
            if (cc < cost[idx]) { cost[idx] = cc; back[idx] = [i, j]; }
          }
        }
        if (i < n) {
          var ch = w[i];
          // lettre muette
          var sc = ch === 'h' || !/[a-zàâäçéèêëîïôöùûüÿœæñ]/.test(ch) ? 0.05 : (ch === 'e' ? 0.6 : (i >= n - 3 ? 0.7 : 1.5));
          var k1 = (i + 1) * W + j;
          if (c0 + sc < cost[k1]) { cost[k1] = c0 + sc; back[k1] = [i, j]; }
          // correspondance inconnue
          if (j < m) {
            var k2 = (i + 1) * W + j + 1;
            if (c0 + 2.5 < cost[k2]) { cost[k2] = c0 + 2.5; back[k2] = [i, j]; }
          }
        }
        if (j < m) {
          var k3 = i * W + j + 1;
          if (c0 + 3 < cost[k3]) { cost[k3] = c0 + 3; back[k3] = [i, j]; }
        }
      }
    }
    var segs = [], ci = n, cj = m;
    while (ci > 0 || cj > 0) {
      var b = back[ci * W + cj];
      segs.push({ l0: b[0], l1: ci, p: ph.slice(b[1], cj) });
      ci = b[0]; cj = b[1];
    }
    segs.reverse();
    return { segs: segs, cost: cost[n * W + m] };
  }

  /* ---------- Entrée : sons + syllabes + lettres de chaque syllabe ---------- */
  function finishSegs(w, segs, syllStr) {
    var ph = '', spans = [], k;           // spans[k] = [l0,l1] des lettres du k-ième son
    var merged = [];
    for (k = 0; k < segs.length; k++) {
      var sg = segs[k];
      if (sg.p === '' && merged.length) merged[merged.length - 1].l1 = sg.l1;      // muette -> son précédent
      else merged.push({ l0: sg.l0, l1: sg.l1, p: sg.p });
    }
    if (merged.length > 1 && merged[0].p === '') { merged[1].l0 = merged[0].l0; merged.shift(); }
    for (k = 0; k < merged.length; k++) {
      for (var q = 0; q < merged[k].p.length; q++) spans.push([merged[k].l0, merged[k].l1]);
      ph += merged[k].p;
    }
    var parts = syllStr ? syllStr.split('-') : syllabify(ph);
    var sylls = [], pos = 0, prevEnd = 0;
    for (k = 0; k < parts.length; k++) {
      var sp = parts[k], vi = -1;
      for (var x = 0; x < sp.length; x++) if (isVow(sp[x])) { vi = x; break; }
      var p0 = pos, p1 = pos + sp.length;
      pos = p1;
      if (!sp.length || !spans.length) continue;
      var l0 = Math.max(prevEnd, spans[Math.min(p0, spans.length - 1)][0]);
      var l1 = Math.max(l0, spans[Math.min(p1, spans.length) - 1][1]);
      if (k === parts.length - 1) l1 = w.length;
      if (k === 0) l0 = 0;
      prevEnd = l1;
      var v = vi >= 0 ? sp[vi] : '';
      sylls.push({
        ph: sp, v: v, cls: v ? CLS[v] : '', weak: v === '°' || v === '',
        on: norm(vi >= 0 ? sp.slice(0, vi) : sp), co: norm(vi >= 0 ? sp.slice(vi + 1) : ''),
        l0: l0, l1: l1, p0: p0
      });
    }
    // une syllabe sans voyelle se colle à sa voisine
    for (k = sylls.length - 1; k >= 0; k--) {
      if (sylls[k].v === '' && sylls.length > 1) {
        if (k > 0) { sylls[k - 1].co += sylls[k].on; sylls[k - 1].ph += sylls[k].ph; sylls[k - 1].l1 = sylls[k].l1; }
        else { sylls[1].on = sylls[0].on + sylls[1].on; sylls[1].ph = sylls[0].ph + sylls[1].ph; sylls[1].l0 = sylls[0].l0; sylls[1].p0 = sylls[0].p0; }
        sylls.splice(k, 1);
      }
    }
    return { ph: ph, syll: parts.join('-'), sylls: sylls, spans: spans };
  }

  function entryFromDict(w, syllStr) {
    var ph = syllStr.replace(/-/g, '');
    var al = align(w, ph);
    return finishSegs(w, al.segs, syllStr);
  }

  root.Phon = {
    VOW: VOW, isVow: isVow, CLS: CLS, CLASSES: CLASSES, CLASS_LABEL: CLASS_LABEL,
    CFAM: CFAM, CFAMS: CFAMS, CFAM_LABEL: CFAM_LABEL,
    norm: norm, readable: readable, syllabify: syllabify, g2p: g2p, align: align, entryFromDict: entryFromDict
  };
})(typeof window !== 'undefined' ? window : globalThis);
