/* Seize — interface. */
(function () {
  'use strict';
  var P = window.Phon, D = window.Dict, R = window.Rhyme, S = window.Store, X = window.Exporter;
  var $ = function (id) { return document.getElementById(id); };
  var el = { app: $('app'), lib: $('lib'), scrim: $('scrim'), list: $('lib-list'), title: $('title'), ed: $('ed'), view: $('view'),
    legend: $('legend'), chips: $('chips'), count: $('count'), find: $('find'), q: $('q'), results: $('results'), heard: $('heard'),
    sheet: $('sheet'), box: $('sheet-box'), toast: $('toast'), color: $('btn-color'), saveState: $('save-state') };

  var DEFAULTS = { theme: 'auto', level: 'asso', allit: false, bars: false, scheme: false, pinTap: false, last: null, find: { mode: 'rime', nsyl: 0, pos: 0, freq: 0, argot: false } };
  var lib = { folders: [], docs: [], settings: JSON.parse(JSON.stringify(DEFAULTS)), custom: {} };
  var cur = null, text = '', colorOn = false, analysis = null, caret = 0, dictReady = false;
  var dirty = false, baselineDone = false, lastAuto = 0, findLimit = 300, selTok = null;
  var pron = {}, pins = [], isolate = null, ctxTok = null;     // prononciations choisies par vers, réserve de rimes, son isolé, mot touché
  function anOpts() { return { pron: function (lt, ti) { var m = pron[lt]; return m ? m[ti] : null; } }; }
  function docBody() {
    var keep = {}, lines = {};
    text.split('\n').forEach(function (l) { lines[l] = 1; });
    Object.keys(pron).forEach(function (l) { if (lines[l] && Object.keys(pron[l]).length) keep[l] = pron[l]; });
    pron = keep;
    return { text: text, pron: pron, pins: pins };
  }
  function ensureIdeas() {
    var m = docMeta('idees');
    if (!m) { m = { id: 'idees', title: 'Carnet d’idées', folder: null, created: Date.now(), updated: Date.now() }; lib.docs.push(m); S.set('doc:idees', { text: '' }); S.set('lib', lib); }
    return m;
  }

  var uid = function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }

  /* ---------- démarrage ---------- */
  function boot() {
    fitViewport();
    S.init().then(function () {
      loadLib();
      if (!lib.docs.length) firstRun();
      applyTheme();
      openDoc(lib.settings.last && docMeta(lib.settings.last) ? lib.settings.last : lib.docs[0].id);
      renderLib(); renderSaveState();
      S.onChange(onStoreChange);
    });
    fetch('data/dict.txt').then(function (r) { if (!r.ok) throw 0; return r.text(); }).catch(function () {
      // certains hébergements ne laissent pas lire un fichier texte : même contenu, chargé comme un script
      return new Promise(function (res, rej) {
        var s = document.createElement('script'); s.src = 'data/dict.js';
        s.onload = function () { if (window.__DICT) res(window.__DICT); else rej(); }; s.onerror = rej;
        document.head.appendChild(s);
      });
    }).then(function (t) {
      D.load(t); D.setCustom(lib.custom); dictReady = true; updateCount();
      if (colorOn) renderView();
      if (!el.find.hidden) runSearch();
    }).catch(function () { toast('Le dictionnaire n’a pas pu se charger. Vérifie la connexion puis recharge la page.'); });
    try {            // police absente (hébergement qui ne sert pas les fichiers de police) : on la prend chez Google Fonts
      if (document.fonts && document.fonts.load) document.fonts.load('700 16px Bricolage').then(function (l) {
        if (l && l.length) return;
        var k = document.createElement('link'); k.rel = 'stylesheet';
        k.href = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wdth,wght@12..96,75..100,200..800&display=swap';
        document.head.appendChild(k);
      }).catch(function () { });
    } catch (e) { }
    try { if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(function () { }); } catch (e) { }
  }
  function loadLib() {
    var l = S.get('lib');
    if (l) {
      lib = l; lib.folders = lib.folders || []; lib.docs = lib.docs || []; lib.custom = lib.custom || {};
      var s = lib.settings || {}; lib.settings = JSON.parse(JSON.stringify(DEFAULTS));
      Object.keys(s).forEach(function (k) { lib.settings[k] = s[k]; });
      lib.settings.find = Object.assign({}, DEFAULTS.find, s.find || {});
    }
    D.setCustom(lib.custom);
  }
  var saveLib = debounce(function () { S.set('lib', lib); }, 300);
  function firstRun() {
    var id = 'exemple';
    lib.docs.push({ id: id, title: 'Exemple à effacer', folder: null, created: 1, updated: 1 });
    S.seed('doc:' + id, { text: "[Couplet 1]\nJ'écris la nuit, le stylo glisse sur la feuille\nDans la cité y'a que le bruit et puis le deuil\nJ'ai la camisole, j'ai pas de bol, je m'isole\nMes rêves s'envolent, ma tête est une boussole\n\nPetit à petit, l'appétit devient maladie\nJe rappe ma vie, c'est ma seule mélodie\n\n[Refrain]\nAppuie sur « Colorer les rimes » pour voir les sons\nPuis sur « Trouver une rime » pour chercher la suite\n" });
    S.seed('lib', lib);
  }
  /* Deux appareils ont chacun modifié la liste des textes : on garde tout, la fiche la plus récente gagne. */
  S.mergeWith('lib', function (a, b, ta, tb) {
    var newer = tb >= ta ? b : a, older = tb >= ta ? a : b, out = JSON.parse(JSON.stringify(newer));
    function union(key, pick) {
      var map = {}, order = [];
      (newer[key] || []).concat(older[key] || []).forEach(function (x) {
        if (!map[x.id]) { map[x.id] = x; order.push(x.id); } else map[x.id] = pick(map[x.id], x);
      });
      return order.map(function (id) { return map[id]; });
    }
    out.docs = union('docs', function (x, y) { return (y.updated || 0) > (x.updated || 0) ? y : x; })
      .filter(function (d) { return !S.deleted('doc:' + d.id); });
    out.folders = union('folders', function (x) { return x; });
    out.custom = Object.assign({}, older.custom || {}, newer.custom || {});
    return out;
  });
  function onStoreChange(ev) {
    renderSaveState();
    if (!ev.changed) return;
    var hadLib = ev.changed.indexOf('lib') >= 0;
    if (hadLib) { loadLib(); applyTheme(); renderLib(); }
    if (cur && !dirty && !baselineDone && hadLib && lib.settings.last !== cur.id && docMeta(lib.settings.last)) return openDoc(lib.settings.last);
    if (cur && !dirty) {
      if (!docMeta(cur.id)) openDoc(lib.docs.length ? lib.docs[0].id : newDocMeta().id);
      else if (ev.changed.indexOf('doc:' + cur.id) >= 0) openDoc(cur.id);
    }
  }
  function renderSaveState() {
    var st = S.state();
    el.saveState.textContent = st === 'cloud' ? (S.durable() ? 'Textes gardés dans ton compte Claude et sur cet appareil' : 'Textes gardés dans ton compte Claude')
      : st === 'connecting' ? 'Connexion à ton compte…'
        : S.durable() ? 'Textes gardés sur cet appareil' : 'Stockage indisponible ici : exporte tes textes avant de fermer';
  }

  /* ---------- écran ---------- */
  function fitViewport() {
    var vv = window.visualViewport;
    function set() {
      var h = vv ? vv.height : window.innerHeight;
      document.documentElement.style.setProperty('--vh', h + 'px');
      if (vv && (window.scrollY || document.documentElement.scrollTop)) window.scrollTo(0, 0);
    }
    set();
    if (vv) { vv.addEventListener('resize', set); vv.addEventListener('scroll', set); }
    window.addEventListener('resize', set);
  }
  function applyTheme() {
    var t = lib.settings.theme;
    if (t === 'auto') t = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', t);
  }
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    (mq.addEventListener ? mq.addEventListener.bind(mq, 'change') : mq.addListener.bind(mq))(function () { applyTheme(); });
  }

  /* ---------- textes ---------- */
  function docMeta(id) { for (var i = 0; i < lib.docs.length; i++) if (lib.docs[i].id === id) return lib.docs[i]; return null; }
  function newDocMeta(folder) {
    var m = { id: uid(), title: '', folder: folder || null, created: Date.now(), updated: Date.now() };
    lib.docs.unshift(m); S.set('doc:' + m.id, { text: '' }); S.set('lib', lib);
    return m;
  }
  function flush() {
    if (!cur || !dirty) return;
    dirty = false;
    S.set('doc:' + cur.id, docBody());
    cur.updated = Date.now(); if (cur.id !== 'idees') cur.title = el.title.value.trim();
    S.set('lib', lib);
    if (text.trim() && Date.now() - lastAuto > 5 * 60000) { addVersion(cur.id, text, ''); lastAuto = Date.now(); }
  }
  var saveSoon = debounce(function () { flush(); renderLib(); }, 700);
  function touch() {
    if (!cur) return;
    if (!baselineDone) {            // garde l'état d'avant la séance d'écriture
      baselineDone = true; lastAuto = Date.now();
      var before = (S.get('doc:' + cur.id) || {}).text || '';
      if (before.trim()) addVersion(cur.id, before, '', cur.updated);
    }
    dirty = true; saveSoon();
  }
  function openDoc(id) {
    flush();
    cur = docMeta(id); if (!cur) return;
    var body = S.get('doc:' + id) || {};
    text = body.text || ''; pron = body.pron || {}; pins = (body.pins || []).slice(); isolate = null; ctxTok = null;
    el.ed.value = text; el.title.value = cur.title || ''; el.title.readOnly = id === 'idees';
    caret = text.length; baselineDone = false; dirty = false; selTok = null;
    lib.settings.last = id; saveLib();
    if (colorOn) renderView();
    updateCount(); renderLib(); closeLib();
  }
  function versions(id) { return (S.get('ver:' + id) || { list: [] }).list; }
  function addVersion(id, t, name, when) {
    var list = versions(id).slice();
    if (list.length && list[list.length - 1].text === t && !name) return;
    list.push({ t: when || Date.now(), text: t, name: name || '' });
    while (list.length > 30 || JSON.stringify(list).length > 180000) {
      var k = 0; while (k < list.length - 1 && list[k].name) k++;
      list.splice(k, 1);
    }
    S.set('ver:' + id, { list: list });
  }
  function deleteDoc(id) {
    lib.docs = lib.docs.filter(function (d) { return d.id !== id; });
    S.del('doc:' + id); S.del('ver:' + id);
    var rest = lib.docs.filter(function (d) { return d.id !== 'idees'; });
    if (!rest.length) rest = [newDocMeta()];
    S.set('lib', lib);
    dirty = false; cur = null; openDoc(rest[0].id);
  }

  function firstLine(id) {
    var t = (id === (cur && cur.id) ? text : (S.get('doc:' + id) || {}).text) || '';
    var ls = t.split('\n').filter(function (l) { return l.trim() && !R.SECTION_RE.test(l); });
    return ls.length ? ls[0].trim() : 'Texte vide';
  }
  function renderLib() {
    var html = '';
    function docsOf(fid) {
      return lib.docs.filter(function (d) { return d.id !== 'idees' && (d.folder || null) === fid; }).sort(function (a, b) { return b.updated - a.updated; })
        .map(function (d) {
          return '<button class="doc" data-doc="' + d.id + '"' + (cur && cur.id === d.id ? ' aria-current="true"' : '') + '><b>' + esc(d.title || 'Sans titre') +
            '</b><small>' + esc(firstLine(d.id)) + '</small></button>';
        }).join('');
    }
    var loose = docsOf(null);
    html += loose;
    lib.folders.forEach(function (f) {
      var inner = docsOf(f.id);
      html += '<div class="folder"><div class="folder-head"><span class="name">' + esc(f.name) + '</span>' +
        '<button class="icon-btn" data-addin="' + f.id + '" aria-label="Nouveau texte dans ' + esc(f.name) + '"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>' +
        '<button class="icon-btn" data-folder="' + f.id + '" aria-label="Options du dossier ' + esc(f.name) + '"><svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg></button></div>' +
        (inner || '<div class="empty">Dossier vide</div>') + '</div>';
    });
    el.list.innerHTML = html;
    var ib = $('open-ideas'), it = (cur && cur.id === 'idees' ? text : (S.get('doc:idees') || {}).text) || '';
    var n = it.split('\n').filter(function (l) { return l.trim(); }).length;
    if (cur && cur.id === 'idees') ib.setAttribute('aria-current', 'true'); else ib.removeAttribute('aria-current');
    $('ideas-sub').textContent = n ? n + ' ligne' + (n > 1 ? 's' : '') : 'Phases et punchlines en vrac';
  }
  function openLib() { el.lib.classList.add('open'); el.scrim.hidden = false; }
  function closeLib() { el.lib.classList.remove('open'); el.scrim.hidden = true; }

  /* ---------- éditeur ---------- */
  function lineAt(pos) {
    var a = text.lastIndexOf('\n', pos - 1) + 1, b = text.indexOf('\n', pos);
    if (b < 0) b = text.length;
    return { a: a, b: b, t: text.slice(a, b) };
  }
  function updateCount() {
    if (colorOn || !dictReady) { el.count.textContent = ''; return; }
    var l = lineAt(caret);
    if (!l.t.trim() || R.SECTION_RE.test(l.t)) { el.count.textContent = ''; return; }
    var n = R.analyze(l.t, anOpts()).lines[0].nsyl;
    el.count.textContent = n + ' syll.';
    el.count.title = 'Syllabes du vers en cours';
  }
  el.ed.addEventListener('input', function () { text = el.ed.value; caret = el.ed.selectionStart; touch(); updateCount(); });
  document.addEventListener('selectionchange', function () {
    if (document.activeElement === el.ed) { caret = el.ed.selectionStart; updateCount(); }
  });
  el.title.addEventListener('input', function () { if (cur && cur.id !== 'idees') { cur.title = el.title.value.trim(); dirty = true; saveSoon(); } });
  el.title.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); el.ed.focus(); } });
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', function () { if (document.hidden) flush(); });

  function setText(t, newCaret) {
    text = t; el.ed.value = t;
    if (newCaret != null) { caret = newCaret; try { el.ed.setSelectionRange(caret, caret); } catch (e) { } }
    touch(); updateCount();
    if (colorOn) renderView();
  }

  /* ---------- couleurs ---------- */
  function setColor(on) {
    if (on && !dictReady) { toast('Le dictionnaire charge encore, réessaie dans un instant.'); return; }
    var ratio = 0, from = on ? el.ed : el.view, to = on ? el.view : el.ed;
    if (from.scrollHeight > from.clientHeight) ratio = from.scrollTop / (from.scrollHeight - from.clientHeight);
    colorOn = on;
    el.color.setAttribute('aria-pressed', on ? 'true' : 'false');
    el.color.querySelector('.long').textContent = on ? 'Modifier le texte' : 'Colorer les rimes';
    el.color.querySelector('.short').textContent = on ? 'Modifier' : 'Colorer';
    el.ed.hidden = on; el.view.hidden = !on; el.legend.hidden = !on;
    if (on) { el.ed.blur(); renderView(); }
    to.scrollTop = ratio * Math.max(0, to.scrollHeight - to.clientHeight);
    updateCount();
  }
  function renderView() {
    analysis = R.analyze(text, anOpts());
    var st = lib.settings, html = '', used = {}, usedFam = {}, blk = null;
    analysis.syl.forEach(function (s) { if (s.rh || (!s.weak && (st.level === 'tout' || (st.level === 'asso' && s.as)))) used[s.cls] = 1; });
    if (isolate) used[isolate] = 1;
    function closeBlock() {
      if (!blk || !st.scheme) { blk = null; return; }
      html += '<div class="sum"><b>' + esc(blk.letters) + '</b> — ' + (blk.tot ? Math.round(100 * blk.rh / blk.tot) : 0) + ' % des syllabes riment</div>';
      blk = null;
    }
    analysis.lines.forEach(function (line, li) {
      if (line.kind !== 'verse' || (blk && blk.id !== line.block)) closeBlock();
      if (line.kind === 'verse') {
        if (!blk) blk = { id: line.block, letters: '', rh: 0, tot: 0 };
        blk.letters += line.letter || '·';
        for (var q = line.first; q < line.last; q++) { blk.tot++; if (analysis.syl[q].rh) blk.rh++; }
      }
      var cls = 'ln' + (line.kind === 'section' ? ' section' : '') + (st.bars && line.kind === 'verse' && line.bar % 4 === 0 ? ' four' : '');
      var body = '';
      R.runs(analysis, li, st.level, st.allit, isolate).forEach(function (r) {
        var c = [];
        if (r.lvl >= 2) { c.push('r', 'c-' + r.cls); if (r.cls === 'in') c.push('in'); }
        else if (r.lvl === 1) c.push('s', 'c-' + r.cls);
        if (r.unk) c.push('unk');
        if (r.fam) { c.push('al', 'f-' + r.fam); usedFam[r.fam] = 1; }
        if (c.length || r.tk != null) body += '<span' + (c.length ? ' class="' + c.join(' ') + '"' : '') + (r.tk != null ? ' data-tk="' + li + ':' + r.tk + '"' : '') + '>' + esc(r.t) + '</span>';
        else body += esc(r.t);
      });
      html += '<div class="' + cls + '">' + (st.bars ? '<span class="g">' + (line.kind === 'verse' ? line.bar : '') + '</span>' : '') +
        '<span class="tx">' + (body || '&nbsp;') + '</span>' + (st.scheme ? '<span class="sch">' + (line.kind === 'verse' ? (line.letter || '·') : '') + '</span>' : '') + (st.bars ? '<span class="n">' + (line.kind === 'verse' ? line.nsyl : '') + '</span>' : '') + '</div>';
    });
    closeBlock();
    el.view.innerHTML = html || '<div class="hint">Le texte est vide. Touche « Modifier le texte » pour écrire.</div>';
    var chips = P.CLASSES.filter(function (c) { return used[c]; }).map(function (c) {
      return '<button class="chip r c-' + c + (c === 'in' ? ' in' : '') + '" data-iso="' + c + '" aria-pressed="' + (isolate === c) + '" title="Ne montrer que ce son">' + P.CLASS_LABEL[c] + '</button>';
    }).join('');
    el.chips.classList.toggle('iso', !!isolate);
    if (st.allit && !isolate) chips += P.CFAMS.filter(function (f) { return usedFam[f]; }).map(function (f) {
      return '<span class="chip al f-' + f + '">' + P.CFAM_LABEL[f] + '</span>';
    }).join('');
    el.chips.innerHTML = chips;
    Array.prototype.forEach.call(el.legend.querySelectorAll('[data-level]'), function (b) { b.setAttribute('aria-pressed', b.dataset.level === st.level ? 'true' : 'false'); });
    $('opt-allit').checked = !!st.allit; $('opt-bars').checked = !!st.bars; $('opt-scheme').checked = !!st.scheme;
  }
  el.color.addEventListener('click', function () { setColor(!colorOn); if (!colorOn) el.ed.focus(); });
  el.legend.addEventListener('click', function (e) {
    var iso = e.target.closest('[data-iso]');
    if (iso) { isolate = isolate === iso.dataset.iso ? null : iso.dataset.iso; renderView(); return; }
    var b = e.target.closest('[data-level]'); if (!b) return;
    lib.settings.level = b.dataset.level; isolate = null; saveLib(); renderView();
  });
  $('opt-allit').addEventListener('change', function (e) { lib.settings.allit = e.target.checked; saveLib(); renderView(); });
  $('opt-bars').addEventListener('change', function (e) { lib.settings.bars = e.target.checked; saveLib(); renderView(); });
  $('opt-scheme').addEventListener('change', function (e) { lib.settings.scheme = e.target.checked; saveLib(); renderView(); });
  el.view.addEventListener('click', function (e) {
    var sp = e.target.closest('span[data-tk]'); if (!sp || !analysis) return;
    var id = sp.dataset.tk.split(':'), line = analysis.lines[+id[0]], tok = line && line.tokens[+id[1]];
    if (!tok) return;
    Array.prototype.forEach.call(el.view.querySelectorAll('.sel'), function (x) { x.classList.remove('sel'); });
    Array.prototype.forEach.call(el.view.querySelectorAll('span[data-tk="' + sp.dataset.tk + '"]'), function (x) { x.classList.add('sel'); });
    // le mot touché devient la recherche ; l'ajout se fera à la fin de ce vers
    var off = 0; for (var i = 0; i < +id[0]; i++) off += analysis.lines[i].text.length + 1;
    caret = off + line.text.length;
    var word = line.text.slice(tok.s, tok.e).replace(/['’]$/, '');
    if (tok.guess) { customSheet(D.clean(word)); return; }       // prononciation devinée : on la corrige d'un geste
    ctxTok = { li: +id[0], ti: +id[1], line: line.text };
    openFind(word, true);
  });

  /* ---------- recherche de rimes ---------- */
  function openFind(word, keepKeyboardDown) {
    el.find.hidden = false; el.app.classList.add('finding');
    syncFilters();
    if (word != null) el.q.value = word;
    findLimit = 300; runSearch();
    if (!keepKeyboardDown) { el.q.focus(); el.q.select(); }
  }
  function closeFind() {
    el.find.hidden = true; el.app.classList.remove('finding'); ctxTok = null;
    Array.prototype.forEach.call(el.view.querySelectorAll('.sel'), function (x) { x.classList.remove('sel'); });
  }
  function syncFilters() {
    var f = lib.settings.find;
    Array.prototype.forEach.call(el.find.querySelectorAll('[data-mode]'), function (b) { b.setAttribute('aria-pressed', b.dataset.mode === f.mode ? 'true' : 'false'); });
    $('f-syl').value = f.nsyl; $('f-pos').value = f.pos; $('f-freq').value = f.freq; $('f-argot').checked = !!f.argot; $('f-pin').checked = !!lib.settings.pinTap;
  }
  function display(r) {
    if (r.flags & D.F.PROPRE && !(r.flags & D.F.PERSO)) return r.w.replace(/(^|[\s\-])([a-zà-ÿ])/g, function (m, a, b) { return a + b.toUpperCase(); });
    return r.w;
  }
  function runSearch() {
    var q = el.q.value.trim();
    var reserve = pins.length ? '<div class="grp">Réserve de ce texte</div><div class="words">' + pins.map(function (w) {
      return '<span class="w pin"><button class="pw" data-w="' + esc(w) + '">' + esc(w) + '</button><button class="x" data-unpin="' + esc(w) + '" aria-label="Retirer ' + esc(w) + ' de la réserve">×</button></span>';
    }).join('') + '</div>' : '';
    if (!q) {
      el.heard.textContent = '';
      el.results.innerHTML = reserve + '<p class="hint">Écris un mot ou la fin d’un vers, par exemple « pas de bol ». Les rimes les plus riches arrivent en premier. Touche un mot pour l’ajouter à ton texte.</p>';
      return;
    }
    if (!dictReady) { el.results.innerHTML = '<p class="hint">Chargement du dictionnaire…</p>'; return; }
    var f = lib.settings.find;
    var single = /^[A-Za-zÀ-ÖØ-öø-ÿŒœ'’\-]+$/.test(q);
    var alts = ctxTok && single ? D.alternatives(q) : [], chosen = ctxTok ? (pron[ctxTok.line] || {})[ctxTok.ti] : null;
    if (chosen && alts.indexOf(chosen) < 0) chosen = null;
    var o = { mode: f.mode, nsyl: +f.nsyl, pos: +f.pos, freq: +f.freq, argot: !!f.argot, limit: findLimit, syll: chosen || undefined };
    var res = f.mode === 'duo' ? D.twoWords(q, o) : D.search(q, o);
    if (alts.length > 1) el.heard.innerHTML = 'Dans ce vers : <span class="alts">' + alts.map(function (s) {
      return '<button data-alt="' + esc(s) + '" aria-pressed="' + ((chosen || alts[0]) === s) + '">' + esc(/[aiyuoOeE°2951@§]/.test(s) ? P.readable(s) : P.readable(s) + ' (avalé)') + '</button>';
    }).join('') + '</span><button id="fix-word">Corriger</button>';
    else el.heard.innerHTML = res.syll ? 'Compris : <b>' + esc(P.readable(res.syll)) + '</b>' + (single ? '<button id="fix-word">Corriger</button>' : '') : '';
    function chip(r) {
      var c = 'w' + (r.flags & D.F.PERSO ? ' perso' : r.flags & D.F.ARGOT ? ' argot' : '');
      return '<button class="' + c + '" data-w="' + esc(display(r)) + '" title="' + esc(P.readable(r.syll)) + '">' + esc(display(r)) + '</button>';
    }
    if (f.mode === 'duo') {
      el.results.innerHTML = reserve + (res.splits.length ? res.splits.map(function (sp) {
        return '<div class="grp">Découpe ' + sp.left + ' + ' + sp.right + ' syllabe' + (sp.right > 1 ? 's' : '') + '</div><div class="duo-label">Premier mot</div><div class="words">' + sp.a.map(chip).join('') +
          '</div><div class="duo-label">Dernier mot</div><div class="words">' + sp.b.map(chip).join('') + '</div>';
      }).join('') : '<p class="hint">Il faut un son d’au moins deux syllabes pour le couper en deux mots, par exemple « camisole ».</p>');
      return;
    }
    if (!res.groups.length) {
      el.results.innerHTML = reserve + '<p class="hint">' + (res.syll ? 'Aucun mot ne correspond avec ces filtres. Retire un filtre, ou passe sur « Assonances » pour élargir.' : 'Aucun son reconnu dans cette recherche.') + '</p>';
      return;
    }
    var html = reserve;
    res.groups.forEach(function (g) {
      var label = f.mode === 'asso' ? (g.nv > 1 ? g.nv + ' voyelles identiques' : 'Même voyelle finale')
        : (g.nv > 1 ? 'Rime sur ' + g.nv + ' syllabes' : 'Rime sur la dernière syllabe');
      html += '<div class="grp">' + label + '</div><div class="words">' + g.items.map(function (r) {
        var c = 'w' + (r.flags & D.F.PERSO ? ' perso' : r.flags & D.F.ARGOT ? ' argot' : '');
        return '<button class="' + c + '" data-w="' + esc(display(r)) + '" title="' + esc(P.readable(r.syll)) + '">' + esc(display(r)) + '</button>';
      }).join('') + '</div>';
    });
    if (res.total > findLimit) html += '<button class="btn more" id="more">Afficher plus de mots (' + (res.total - findLimit) + ' restants)</button>';
    el.results.innerHTML = html;
  }
  var searchSoon = debounce(function () { findLimit = 300; runSearch(); el.results.scrollTop = 0; }, 180);
  el.q.addEventListener('input', function () { ctxTok = null; searchSoon(); });
  el.q.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); el.q.blur(); } });
  $('btn-find').addEventListener('click', function () {
    if (!el.find.hidden) { closeFind(); return; }
    ctxTok = null;
    var sel = el.ed.selectionStart !== el.ed.selectionEnd && !colorOn ? text.slice(el.ed.selectionStart, el.ed.selectionEnd).trim() : null;
    openFind(sel && sel.length < 60 ? sel : null);
  });
  $('find-close').addEventListener('click', closeFind);
  $('q-line').addEventListener('click', function () {
    var l = lineAt(caret), t = l.t;
    if (!t.trim() && l.a > 0) t = lineAt(l.a - 1).t;          // ligne vide : on prend le vers d'avant
    var m = t.match(/[A-Za-zÀ-ÖØ-öø-ÿŒœ]+(?:['’\-][A-Za-zÀ-ÖØ-öø-ÿŒœ]+)*/g);
    if (!m) { toast('Place d’abord le curseur sur un vers.'); return; }
    ctxTok = null; el.q.value = m[m.length - 1].replace(/^.*['’]/, ''); findLimit = 300; runSearch();
  });
  el.find.addEventListener('click', function (e) {
    var m = e.target.closest('[data-mode]');
    if (m) { lib.settings.find.mode = m.dataset.mode; saveLib(); syncFilters(); findLimit = 300; runSearch(); return; }
    var un = e.target.closest('[data-unpin]');
    if (un) { pins = pins.filter(function (x) { return x !== un.dataset.unpin; }); touch(); runSearch(); return; }
    var pw = e.target.closest('.pw');
    if (pw) { insertWord(pw.dataset.w); return; }
    var alt = e.target.closest('[data-alt]');
    if (alt && ctxTok) {                    // prononciation de ce mot dans ce vers
      var first = D.alternatives(el.q.value.trim())[0], map = pron[ctxTok.line] || (pron[ctxTok.line] = {});
      if (alt.dataset.alt === first) delete map[ctxTok.ti]; else map[ctxTok.ti] = alt.dataset.alt;
      touch();
      if (colorOn) {
        renderView();
        Array.prototype.forEach.call(el.view.querySelectorAll('span[data-tk="' + ctxTok.li + ':' + ctxTok.ti + '"]'), function (x) { x.classList.add('sel'); });
      }
      runSearch(); return;
    }
    var w = e.target.closest('button.w');
    if (w) {
      if (lib.settings.pinTap) {
        if (pins.indexOf(w.dataset.w) < 0) { pins.push(w.dataset.w); touch(); runSearch(); }
        toast('« ' + w.dataset.w + ' » mis en réserve');
      } else insertWord(w.dataset.w);
      return;
    }
    if (e.target.id === 'more') { findLimit += 600; runSearch(); return; }
    if (e.target.id === 'fix-word') customSheet(el.q.value.trim().toLowerCase());
  });
  ['f-syl', 'f-pos', 'f-freq'].forEach(function (id) {
    $(id).addEventListener('change', function (e) { lib.settings.find[{ 'f-syl': 'nsyl', 'f-pos': 'pos', 'f-freq': 'freq' }[id]] = +e.target.value; saveLib(); findLimit = 300; runSearch(); });
  });
  $('f-pin').addEventListener('change', function (e) { lib.settings.pinTap = e.target.checked; saveLib(); });
  $('f-argot').addEventListener('change', function (e) { lib.settings.find.argot = e.target.checked; saveLib(); findLimit = 300; runSearch(); });

  function insertWord(w) {
    var before = text, c = Math.min(caret, text.length), prev = text[c - 1], next = text[c];
    var ins = (c > 0 && prev && !/[\s'’\-(«]/.test(prev) ? ' ' : '') + w + (next && !/[\s,.;:!?)»]/.test(next) ? ' ' : '');
    var oldCaret = caret;
    setText(text.slice(0, c) + ins + text.slice(c), c + ins.length);
    toast('« ' + w + ' » ajouté au texte', 'Annuler', function () { setText(before, oldCaret); });
  }

  /* ---------- sections ---------- */
  $('btn-section').addEventListener('click', function () {
    var kinds = ['Intro', 'Couplet', 'Pré-refrain', 'Refrain', 'Pont', 'Outro'];
    sheet('<h2>Ajouter une section</h2><p>Une section sépare les blocs de rimes et remet le compte des mesures à zéro.</p><div class="rows">' +
      kinds.map(function (k) { return '<button class="row" data-sec="' + k + '">' + k + '</button>'; }).join('') + '</div>');
    el.box.onclick = function (e) {
      var b = e.target.closest('[data-sec]'); if (!b) return;
      var k = b.dataset.sec, label = k;
      if (k === 'Couplet') label = 'Couplet ' + ((text.match(/^\s*\[Couplet/gim) || []).length + 1);
      var l = lineAt(Math.min(caret, text.length)), at = l.t.trim() ? l.b : l.a;
      var pre = text.slice(0, at), post = text.slice(at);
      var head = (pre && !/\n\n$/.test(pre) ? (/\n$/.test(pre) ? '\n' : '\n\n') : '') + '[' + label + ']\n';
      closeSheet();
      setText(pre + head + post.replace(/^\n/, ''), (pre + head).length);
      if (!colorOn) el.ed.focus();
    };
  });

  /* ---------- feuilles ---------- */
  function sheet(html) { el.box.innerHTML = html; el.box.onclick = null; el.sheet.hidden = false; el.box.scrollTop = 0; }
  function closeSheet() { el.sheet.hidden = true; el.box.innerHTML = ''; el.box.onclick = null; }
  el.sheet.addEventListener('click', function (e) { if (e.target === el.sheet) closeSheet(); });
  function ask(title, label, value, okLabel, cb) {
    sheet('<h2>' + esc(title) + '</h2><label class="field">' + esc(label) + '<input id="ask-in" type="text" autocomplete="off"></label>' +
      '<div class="actions"><button class="btn" data-x="no">Annuler</button><button class="btn primary" data-x="ok">' + esc(okLabel) + '</button></div>');
    var inp = $('ask-in'); inp.value = value || ''; inp.focus(); inp.select();
    function done() { var v = inp.value.trim(); if (!v) return; closeSheet(); cb(v); }
    inp.onkeydown = function (e) { if (e.key === 'Enter') done(); };
    el.box.onclick = function (e) { var x = e.target.dataset && e.target.dataset.x; if (x === 'no') closeSheet(); if (x === 'ok') done(); };
  }
  function confirmSheet(title, body, okLabel, cb) {
    sheet('<h2>' + esc(title) + '</h2><p>' + esc(body) + '</p><div class="actions"><button class="btn" data-x="no">Annuler</button><button class="btn danger" data-x="ok">' + esc(okLabel) + '</button></div>');
    el.box.onclick = function (e) { var x = e.target.dataset && e.target.dataset.x; if (x === 'no') closeSheet(); if (x === 'ok') { closeSheet(); cb(); } };
  }
  var toastTimer;
  function toast(msg, action, fn) {
    el.toast.innerHTML = '<span>' + esc(msg) + '</span>' + (action ? '<button>' + esc(action) + '</button>' : '');
    el.toast.hidden = false;
    var b = el.toast.querySelector('button');
    if (b) b.onclick = function () { el.toast.hidden = true; fn(); };
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.toast.hidden = true; }, action ? 6000 : 3800);
  }
  function fmtDate(t) {
    var d = new Date(t), now = new Date(), same = d.toDateString() === now.toDateString();
    var hm = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    return same ? 'Aujourd’hui à ' + hm : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' }) + ' à ' + hm;
  }

  /* menu du texte */
  $('btn-more').addEventListener('click', function () {
    flush();
    var isIdeas = cur.id === 'idees';
    sheet('<h2>' + esc(cur.title || 'Sans titre') + '</h2><div class="rows">' +
      (isIdeas ? '' : '<button class="row" data-a="idea"><span class="grow">Noter une idée dans le carnet<small>Sans quitter ce texte</small></span></button>') +
      '<button class="row" data-a="ver"><span class="grow">Historique des versions<small>' + versions(cur.id).length + ' version(s) gardée(s)</small></span></button>' +
      '<button class="row" data-a="txt"><span class="grow">Exporter en texte brut</span></button>' +
      '<button class="row" data-a="pdf"><span class="grow">Exporter en PDF<small>Texte seul</small></span></button>' +
      '<button class="row" data-a="pdfc"><span class="grow">Exporter en PDF avec les couleurs<small>Avec les réglages de couleur en cours</small></span></button>' +
      (isIdeas ? '' : '<button class="row" data-a="move"><span class="grow">Ranger dans un dossier</span></button>' +
      '<button class="row danger" data-a="del"><span class="grow">Supprimer ce texte</span></button>') + '</div>');
    el.box.onclick = function (e) {
      var b = e.target.closest('[data-a]'); if (!b) return;
      var a = b.dataset.a, o = { title: cur.title, text: text, level: lib.settings.level, allit: lib.settings.allit, analyzeOpts: anOpts() };
      if (a === 'idea') return ideaSheet();
      if (a === 'ver') return versionsSheet();
      if (a === 'move') return moveSheet();
      if (a === 'del') return confirmSheet('Supprimer « ' + (cur.title || 'Sans titre') + ' » ?', 'Le texte et son historique seront supprimés.', 'Supprimer', function () { deleteDoc(cur.id); });
      closeSheet();
      var job = a === 'txt' ? X.txt(o) : (o.colors = a === 'pdfc', dictReady || !o.colors ? X.pdf(o) : Promise.reject());
      Promise.resolve(job).then(function (r) { if (r === 'ok') toast('Export prêt'); }, function () { toast('L’export n’a pas abouti. Réessaie.'); });
    };
  });
  function versionsSheet() {
    var list = versions(cur.id).slice().reverse();
    sheet('<h2>Historique des versions</h2><p>Une version est gardée automatiquement au début de chaque séance d’écriture, puis toutes les cinq minutes.</p>' +
      '<div class="actions" style="justify-content:flex-start;margin-top:0"><button class="btn primary" data-v="save">Garder la version actuelle</button></div><div class="rows">' +
      (list.length ? list.map(function (v, i) {
        var n = v.text.split('\n').filter(function (l) { return l.trim(); }).length;
        return '<button class="row" data-v="' + i + '"><span class="grow">' + esc(v.name || fmtDate(v.t)) + '<small>' + (v.name ? fmtDate(v.t) + ' · ' : '') + n + ' ligne(s)</small></span></button>';
      }).join('') : '<div class="empty">Aucune version pour l’instant.</div>') + '</div>');
    el.box.onclick = function (e) {
      var b = e.target.closest('[data-v]'); if (!b) return;
      if (b.dataset.v === 'save') return ask('Garder cette version', 'Nom de la version', 'Version du ' + new Date().toLocaleDateString('fr-FR'), 'Garder', function (name) { addVersion(cur.id, text, name); versionsSheet(); });
      var v = list[+b.dataset.v];
      sheet('<h2>' + esc(v.name || fmtDate(v.t)) + '</h2><div class="preview">' + esc(v.text) + '</div><div class="actions"><button class="btn" data-x="back">Retour</button><button class="btn primary" data-x="ok">Restaurer cette version</button></div>');
      el.box.onclick = function (ev) {
        var x = ev.target.dataset && ev.target.dataset.x;
        if (x === 'back') versionsSheet();
        if (x === 'ok') { if (text.trim()) addVersion(cur.id, text, 'Avant restauration'); closeSheet(); setText(v.text, v.text.length); flush(); toast('Version restaurée'); }
      };
    };
  }
  function moveSheet() {
    sheet('<h2>Ranger dans un dossier</h2><div class="rows"><button class="row" data-f="">Aucun dossier</button>' +
      lib.folders.map(function (f) { return '<button class="row" data-f="' + f.id + '">' + esc(f.name) + '</button>'; }).join('') +
      '<button class="row" data-f="+">Nouveau dossier…</button></div>');
    el.box.onclick = function (e) {
      var b = e.target.closest('[data-f]'); if (!b) return;
      var f = b.dataset.f;
      if (f === '+') return ask('Nouveau dossier', 'Nom du dossier', '', 'Créer', function (name) { var nf = { id: uid(), name: name }; lib.folders.push(nf); cur.folder = nf.id; S.set('lib', lib); renderLib(); });
      cur.folder = f || null; S.set('lib', lib); renderLib(); closeSheet();
    };
  }

  /* carnet d'idées */
  function ideaSheet() {
    sheet('<h2>Noter une idée</h2><label class="field">Phase, punchline, image…<textarea id="idea-in"></textarea></label>' +
      '<div class="actions"><button class="btn" data-x="no">Annuler</button><button class="btn primary" data-x="ok">Noter dans le carnet</button></div>');
    var inp = $('idea-in'); inp.focus();
    el.box.onclick = function (e) {
      var x = e.target.dataset && e.target.dataset.x; if (!x) return;
      if (x === 'no') return closeSheet();
      var idea = inp.value.trim(); if (!idea) return;
      var m = ensureIdeas();
      if (cur && cur.id === 'idees') setText((text.trim() ? text.replace(/\s+$/, '') + '\n\n' : '') + idea + '\n', null);
      else {
        var b = S.get('doc:idees') || {}, old = b.text || '';
        S.set('doc:idees', Object.assign({}, b, { text: (old.trim() ? old.replace(/\s+$/, '') + '\n\n' : '') + idea + '\n' }));
        m.updated = Date.now(); S.set('lib', lib);
      }
      closeSheet(); renderLib(); toast('Idée notée dans le carnet');
    };
  }
  $('open-ideas').addEventListener('click', function () { flush(); ensureIdeas(); openDoc('idees'); });
  $('add-idea').addEventListener('click', function () { closeLib(); ideaSheet(); });

  /* bibliothèque */
  $('btn-lib').addEventListener('click', openLib);
  $('lib-close').addEventListener('click', closeLib);
  el.scrim.addEventListener('click', closeLib);
  $('new-doc').addEventListener('click', function () { flush(); var m = newDocMeta(); openDoc(m.id); if (colorOn) setColor(false); el.title.focus(); });
  $('new-folder').addEventListener('click', function () {
    ask('Nouveau dossier', 'Nom du dossier', '', 'Créer', function (name) { lib.folders.push({ id: uid(), name: name }); S.set('lib', lib); renderLib(); });
  });
  el.list.addEventListener('click', function (e) {
    var d = e.target.closest('[data-doc]'); if (d) return openDoc(d.dataset.doc);
    var a = e.target.closest('[data-addin]'); if (a) { flush(); var m = newDocMeta(a.dataset.addin); openDoc(m.id); if (colorOn) setColor(false); el.title.focus(); return; }
    var fb = e.target.closest('[data-folder]'); if (!fb) return;
    var f = lib.folders.filter(function (x) { return x.id === fb.dataset.folder; })[0];
    sheet('<h2>' + esc(f.name) + '</h2><div class="rows"><button class="row" data-a="ren">Renommer le dossier</button><button class="row danger" data-a="del">Supprimer le dossier<small style="margin-left:8px">Les textes sont conservés</small></button></div>');
    el.box.onclick = function (ev) {
      var b = ev.target.closest('[data-a]'); if (!b) return;
      if (b.dataset.a === 'ren') return ask('Renommer le dossier', 'Nom du dossier', f.name, 'Renommer', function (name) { f.name = name; S.set('lib', lib); renderLib(); });
      lib.docs.forEach(function (x) { if (x.folder === f.id) x.folder = null; });
      lib.folders = lib.folders.filter(function (x) { return x.id !== f.id; });
      S.set('lib', lib); renderLib(); closeSheet();
    };
  });

  /* réglages, mots perso, sauvegarde */
  $('open-settings').addEventListener('click', settingsSheet);
  function settingsSheet() {
    var words = Object.keys(lib.custom).sort();
    sheet('<h2>Réglages</h2>' +
      '<div class="field">Apparence<div class="seg" style="display:flex;margin-top:6px">' +
      [['auto', 'Automatique'], ['light', 'Clair'], ['dark', 'Sombre']].map(function (t) { return '<button data-theme-set="' + t[0] + '" aria-pressed="' + (lib.settings.theme === t[0]) + '" style="flex:1">' + t[1] + '</button>'; }).join('') + '</div></div>' +
      '<h2 style="margin-top:20px">Mes mots</h2><p>Argot, noms propres, mots récents : ajoute un mot et écris comment il se prononce. Il sera coloré et proposé dans les rimes.</p>' +
      '<div class="rows">' + words.map(function (w) { return '<button class="row" data-cw="' + esc(w) + '"><span class="grow">' + esc(w) + '<small>' + esc(P.readable(lib.custom[w].syll)) + '</small></span></button>'; }).join('') +
      '<button class="row" data-cw="">Ajouter un mot…</button></div>' +
      '<h2 style="margin-top:20px">Sauvegarde</h2><p>' + esc(el.saveState.textContent) + '. Le fichier de sauvegarde contient tous tes textes, dossiers, versions et mots.</p>' +
      '<div class="actions" style="justify-content:flex-start"><button class="btn" data-x="exp">Exporter une sauvegarde</button><button class="btn" data-x="imp">Importer une sauvegarde</button></div>' +
      '<input type="file" id="imp-file" accept=".json,application/json" hidden>' +
      '<p style="margin-top:20px;font-size:.78rem">Dictionnaire : Lexique 3.83 (lexique.org, CC BY-SA 4.0) complété par ipa-dict, plus une liste d’argot. ' + (dictReady ? D.size().toLocaleString('fr-FR') + ' formes.' : '') + '</p>');
    el.box.onclick = function (e) {
      var t = e.target.closest('[data-theme-set]');
      if (t) { lib.settings.theme = t.dataset.themeSet; S.set('lib', lib); applyTheme(); return settingsSheet(); }
      var cw = e.target.closest('[data-cw]'); if (cw) return customSheet(cw.dataset.cw, true);
      var x = e.target.dataset && e.target.dataset.x;
      if (x === 'exp') { flush(); X.backup({ app: 'seize', v: 1, at: Date.now(), data: S.dump() }).then(function (r) { if (r === 'ok') toast('Sauvegarde prête'); }, function () { toast('La sauvegarde n’a pas abouti.'); }); }
      if (x === 'imp') $('imp-file').click();
    };
    $('imp-file').onchange = function (e) {
      var f = e.target.files[0]; if (!f) return;
      f.text().then(function (t) {
        var o = JSON.parse(t);
        if (!o || o.app !== 'seize' || !o.data || !o.data.lib) throw 0;
        // on ajoute sans rien écraser : les textes importés qui existent déjà gardent la version importée
        flush();
        var inc = o.data, mine = S.get('lib') || lib, ids = {};
        mine.docs.forEach(function (d) { ids[d.id] = 1; });
        inc.lib.docs.forEach(function (d) { if (!ids[d.id]) mine.docs.push(d); });
        var fids = {}; mine.folders.forEach(function (x) { fids[x.id] = 1; });
        (inc.lib.folders || []).forEach(function (x) { if (!fids[x.id]) mine.folders.push(x); });
        Object.keys(inc.lib.custom || {}).forEach(function (w) { if (!mine.custom[w]) mine.custom[w] = inc.lib.custom[w]; });
        Object.keys(inc).forEach(function (k) { if (k !== 'lib') S.set(k, inc[k]); });
        S.set('lib', mine); loadLib(); dirty = false; openDoc(cur && docMeta(cur.id) ? cur.id : lib.docs[0].id); renderLib(); closeSheet();
        toast('Sauvegarde importée');
      }).catch(function () { toast('Ce fichier n’est pas une sauvegarde Seize.'); });
    };
  }
  function customSheet(word, fromSettings) {
    var ex = word && lib.custom[word];
    sheet('<h2>' + (ex ? 'Modifier un mot' : 'Ajouter un mot') + '</h2>' +
      '<label class="field">Le mot, tel que tu l’écris<input id="cw-w" type="text" autocapitalize="none" autocomplete="off" spellcheck="false"></label>' +
      '<label class="field">Comment il se prononce, écrit simplement<input id="cw-s" type="text" autocapitalize="none" autocomplete="off" spellcheck="false" placeholder="ex. ouèche pour wesh"></label>' +
      '<div class="heard-box" id="cw-h"></div><p>Si une consonne finale doit sonner, double-la : « tiekss ».</p>' +
      '<div class="actions">' + (ex ? '<button class="btn danger" data-x="del">Retirer</button>' : '') + '<button class="btn" data-x="no">Annuler</button><button class="btn primary" data-x="ok">Enregistrer</button></div>');
    var iw = $('cw-w'), is = $('cw-s'), h = $('cw-h');
    iw.value = word || ''; is.value = ex ? ex.say : (word || '');
    function sy() { return is.value.toLowerCase().split(/[\s\-]+/).filter(Boolean).map(function (p) { return P.g2p(p).syll; }).filter(Boolean).join('-'); }
    function show() { var s = sy(); h.innerHTML = s ? 'Compris : <b>' + esc(P.readable(s)) + '</b>' : 'Écris la prononciation pour voir ce que l’app comprend.'; }
    is.oninput = show; show(); (word ? is : iw).focus();
    function back() { if (fromSettings) settingsSheet(); else closeSheet(); }
    el.box.onclick = function (e) {
      var x = e.target.dataset && e.target.dataset.x; if (!x) return;
      if (x === 'no') return back();
      var w = D.clean(iw.value.trim());
      if (x === 'del') { delete lib.custom[word]; }
      else {
        var s = sy();
        if (!w || !s || !/^[a-zà-öø-ÿ'\-]+$/.test(w)) { toast('Écris un seul mot, puis sa prononciation.'); return; }
        if (word && word !== w) delete lib.custom[word];
        lib.custom[w] = { say: is.value.trim(), syll: s };
      }
      S.set('lib', lib); D.setCustom(lib.custom);
      if (colorOn) renderView();
      if (!el.find.hidden) runSearch();
      back(); toast(x === 'del' ? 'Mot retiré' : '« ' + w + ' » enregistré');
    };
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { if (!el.sheet.hidden) closeSheet(); else if (!el.find.hidden) closeFind(); else closeLib(); }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openFind(null); }
  });

  window.Seize = { setColor: setColor, openFind: openFind, state: function () { return { lib: lib, cur: cur, text: text, dictReady: dictReady }; } };
  boot();
})();
