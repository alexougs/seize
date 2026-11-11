/* Seize — stockage. Tout est gardé sur l'appareil (IndexedDB). Quand la page tourne dans Claude,
   une copie est aussi gardée dans le compte de la personne ; la version la plus récente gagne. */
(function (root) {
  'use strict';
  var mem = {};                 // clé -> {v, t, d}
  var idb = null, lsMode = false, remote = null, remoteState = 'local';
  var listeners = [], pushTimers = {}, pushing = {}, dirty = {}, seenT = {}, merger = null;

  function openIdb() {
    return new Promise(function (res) {
      try {
        var rq = indexedDB.open('seize', 1);
        rq.onupgradeneeded = function () { rq.result.createObjectStore('kv'); };
        rq.onsuccess = function () { res(rq.result); };
        rq.onerror = function () { res(null); };
        rq.onblocked = function () { res(null); };
        setTimeout(function () { res(null); }, 4000);
      } catch (e) { res(null); }
    });
  }
  function idbAll() {
    return new Promise(function (res) {
      try {
        var out = {}, tx = idb.transaction('kv', 'readonly'), rq = tx.objectStore('kv').openCursor();
        rq.onsuccess = function () { var c = rq.result; if (c) { out[c.key] = c.value; c.continue(); } else res(out); };
        rq.onerror = function () { res(out); };
      } catch (e) { res({}); }
    });
  }
  function persist(key) {
    var rec = mem[key];
    try {
      if (idb) idb.transaction('kv', 'readwrite').objectStore('kv').put(rec, key);
      else if (lsMode) localStorage.setItem('seize.kv', JSON.stringify(mem));
    } catch (e) { /* mémoire seule */ }
  }

  function init() {
    return openIdb().then(function (db) {
      idb = db;
      if (idb) return idbAll();
      try { var raw = localStorage.getItem('seize.kv'); lsMode = true; return raw ? JSON.parse(raw) : {}; }
      catch (e) { lsMode = false; return {}; }
    }).then(function (all) {
      mem = all || {};
      try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { }
      connectRemote();
      return true;
    });
  }

  function get(key) { var r = mem[key]; return r && !r.d ? r.v : undefined; }
  function set(key, v) { mem[key] = { v: v, t: Date.now(), d: 0 }; persist(key); queuePush(key); }
  function seed(key, v) { mem[key] = { v: v, t: 1, d: 0 }; persist(key); }   // contenu de départ : toute vraie donnée passe devant
  function del(key) { mem[key] = { v: null, t: Date.now(), d: 1 }; persist(key); queuePush(key); }
  function keys(prefix) { return Object.keys(mem).filter(function (k) { return k.indexOf(prefix) === 0 && !mem[k].d; }); }
  function dump() { var o = {}; Object.keys(mem).forEach(function (k) { if (!mem[k].d) o[k] = mem[k].v; }); return o; }
  function restore(obj) { Object.keys(obj).forEach(function (k) { set(k, obj[k]); }); }

  /* ---- Copie dans le compte Claude (seulement quand la page y est hébergée) ---- */
  function seg(key) { return key.replace(/[^A-Za-z0-9_\-.~:@+]/g, '_'); }
  function setState(s) { remoteState = s; listeners.forEach(function (f) { try { f({ state: s }); } catch (e) { } }); }
  function connectRemote() {
    if (!root.claude || typeof root.claude.use !== 'function') return;
    setState('connecting');
    Promise.all([root.claude.use('db'), root.claude.use('user')]).then(function (r) {
      var db = r[0], user = r[1];
      if (!db || !user) return setState('local');
      return user.id().then(function (uid) {
        if (!uid) return setState('local');
        var col = db.collection('data/users/' + uid);
        return col.limit(1000).get().then(function (snap) {
          remote = col;
          var changed = [], seen = {}, rows = [];
          snap.docs.forEach(function (d) { var x = d.data(); if (x && typeof x.k === 'string') rows.push(x); });
          rows.sort(function (a, b) { return (a.k === 'lib') - (b.k === 'lib'); });      // l'index des textes en dernier
          rows.forEach(function (x) {
            seen[x.k] = 1; seenT[x.k] = x.t || 0;
            var loc = mem[x.k];
            if (merger && loc && !loc.d && !x.d && loc.t !== x.t && merger.key === x.k) {
              var rv = null; try { rv = JSON.parse(x.v); } catch (e) { return; }
              mem[x.k] = { v: merger.fn(loc.v, rv, loc.t, x.t || 0), t: Date.now(), d: 0 }; persist(x.k); changed.push(x.k); queuePush(x.k);
              return;
            }
            if (!loc || (x.t || 0) > loc.t) {
              var v = null; try { v = x.d ? null : JSON.parse(x.v); } catch (e) { return; }
              mem[x.k] = { v: v, t: x.t || 0, d: x.d ? 1 : 0 }; persist(x.k); changed.push(x.k);
            } else if (loc.t > (x.t || 0)) queuePush(x.k);
          });
          Object.keys(mem).forEach(function (k) { if (!seen[k]) queuePush(k); });
          setState('cloud');
          if (changed.length) listeners.forEach(function (f) { try { f({ changed: changed }); } catch (e) { } });
        });
      });
    }).catch(function () { setState('local'); });
  }
  function queuePush(key) {
    if (!remote) return;
    dirty[key] = 1;
    clearTimeout(pushTimers[key]);
    pushTimers[key] = setTimeout(function () { push(key); }, 1500);
  }
  function push(key) {
    if (!remote || pushing[key]) { if (pushing[key]) pushTimers[key] = setTimeout(function () { push(key); }, 1500); return; }
    var rec = mem[key]; if (!rec) return;
    var body = { k: key, t: rec.t, d: rec.d ? 1 : 0, v: rec.d ? '' : JSON.stringify(rec.v) };
    if (body.v.length > 230000) return;           // trop gros pour la copie en ligne : reste sur l'appareil
    pushing[key] = 1; delete dirty[key];
    var ref = remote.doc(seg(key)), pre = Promise.resolve();
    if (merger && merger.key === key && !rec.d) pre = ref.get().then(function (snap) {
      // un autre appareil a changé l'index entre-temps : on fusionne avant d'écrire
      var x = snap && snap.exists ? snap.data() : null;
      if (!x || x.d || !(x.t > (seenT[key] || 0)) || x.t === rec.t) return;
      var rv = JSON.parse(x.v), cur = mem[key];
      mem[key] = { v: merger.fn(cur.v, rv, cur.t, x.t), t: Date.now(), d: 0 }; persist(key);
      body.t = mem[key].t; body.v = JSON.stringify(mem[key].v);
      listeners.forEach(function (f) { try { f({ changed: [key] }); } catch (e) { } });
    }).catch(function () { });
    pre.then(function () { seenT[key] = body.t; return ref.set(body); }).then(function () { pushing[key] = 0; }, function (e) {
      pushing[key] = 0;
      if (e && (e.code === 'unavailable' || e.code === 'resource_exhausted')) { dirty[key] = 1; pushTimers[key] = setTimeout(function () { push(key); }, 8000); }
      else if (e && (e.code === 'revoked' || e.code === 'not_granted' || e.code === 'invalid_argument')) { remote = null; setState('local'); }
    });
  }

  root.Store = {
    init: init, get: get, set: set, seed: seed, del: del, keys: keys, dump: dump, restore: restore,
    deleted: function (key) { return !!(mem[key] && mem[key].d); },
    mergeWith: function (key, fn) { merger = { key: key, fn: fn }; },
    onChange: function (f) { listeners.push(f); },
    state: function () { return remoteState; },
    durable: function () { return !!idb || lsMode; }
  };
})(window);
