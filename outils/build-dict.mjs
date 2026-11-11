// Construit app/data/dict.txt : mot \t sons-en-syllabes \t drapeaux(base36)+fréquence(0-9)
// Sources à placer dans outils/sources/ : lexique.tsv (Lexique383 en UTF-8, lexique.org) et fr_FR.txt (ipa-dict).
import fs from 'node:fs';
await import('../js/phon.js');
const P = globalThis.Phon;
const POS = { NOM: 1, VER: 2, AUX: 2, ADJ: 4, ADV: 8 };
const ARGOT = 32, PROPRE = 64;
const num = s => parseFloat((s || '0').replace(',', '.')) || 0;
const bucket = f => Math.max(0, Math.min(9, Math.round(Math.log10(f * 100 + 1) * 1.5)));
const okWord = w => /^[a-zàâäçéèêëîïôöùûüÿñ'\- .]+$/.test(w);
const fixOrtho = w => w.replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/’/g, "'");

const E = new Map();   // "mot|sons" -> {w, syll, flags, f}
// 1. Lexique 3.83
const FIX = { marin: 'ma-R5', marins: 'ma-R5' };
for (const line of fs.readFileSync(new URL('./sources/lexique.tsv', import.meta.url), 'utf8').split('\n').slice(1)) {
  if (!line) continue;
  const r = line.split('\t');
  let w = fixOrtho(r[0].toLowerCase()), syll = r[22], ph = r[1];
  if (FIX[w]) { syll = FIX[w]; ph = syll.replace(/-/g, ''); }
  if (!okWord(w) || ph.includes('0') || ph.includes('-')) continue;
  syll = syll.replace(/x/g, 'R').replace(/r/g, 'R'); ph = syll.replace(/-/g, '');
  if (!ph || [...ph].some(c => !"aiyuoOeE°2951@§j8wpbtdkgfvszSZmnNGlR".includes(c))) continue;
  const key = w + '|' + ph, f = (num(r[8]) + num(r[9])) / 2;
  const pos = POS[r[3].split(':')[0]] || 16;
  const e = E.get(key);
  if (e) { e.f += f; e.flags |= pos; } else E.set(key, { w, syll, flags: pos, f });
}
const lexWords = new Set([...E.values()].map(e => e.w));
console.log('Lexique :', E.size, 'formes');

// 2. Liste IPA (formes absentes de Lexique : conjugaisons, mots rares, noms propres)
const IPA = { 'ʁ': 'R', 'ɑ': 'a', 'ɛ': 'E', 'ɔ': 'O', 'œ': '9', 'ø': '2', 'ə': '°', 'ɥ': '8', 'ʒ': 'Z', 'ʃ': 'S', 'ɲ': 'N', 'ŋ': 'G', 'ɡ': 'g', 'ɪ': 'i', 'ʊ': 'u', 'x': 'R' };
function ipa2lex(s) {
  s = s.normalize('NFD').replace(/[ːʼ.ˈˌ‿ ]/g, '');
  let o = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i], nasal = s[i + 1] === '̃';
    if (nasal) { o += ({ 'ɑ': '@', 'a': '@', 'ɛ': '5', 'e': '5', 'ɔ': '§', 'o': '§', 'œ': '1' })[c] || '?'; i++; continue; }
    if (c === '̃') { o += '?'; continue; }
    o += IPA[c] || c;
  }
  return o;
}
let nIpa = 0;
for (const line of fs.readFileSync(new URL('./sources/fr_FR.txt', import.meta.url), 'utf8').split('\n')) {
  if (!line) continue;
  const [w0, pr] = line.split('\t');
  if (!pr || w0.includes(' ')) continue;
  const proper = /^[A-ZÀÂÄÇÉÈÊËÎÏÔÖÙÛÜ]/.test(w0) && w0 !== w0.toUpperCase();
  const w = fixOrtho(w0.toLowerCase());
  if (!okWord(w) || w.includes('.') || lexWords.has(w) || w.length < 2) continue;
  const ph = ipa2lex(pr.split(',')[0].trim().replace(/\//g, ''));
  if (!ph || [...ph].some(c => !"aiyuoOeE°2951@§j8wpbtdkgfvszSZmnNGlR".includes(c))) continue;
  const key = w + '|' + ph;
  if (E.has(key)) continue;
  E.set(key, { w, syll: P.syllabify(ph).join('-'), flags: proper ? PROPRE | 1 : 0, f: 0 });
  nIpa++;
}
console.log('Liste IPA : +', nIpa);

// 3. Argot, verlan, vocabulaire rap
const byWord = new Map();
for (const e of E.values()) { if (!byWord.has(e.w)) byWord.set(e.w, []); byWord.get(e.w).push(e); }
let nArgot = 0, nTag = 0; const argotLog = [];
for (const line of fs.readFileSync(new URL('./argot.txt', import.meta.url), 'utf8').split('\n')) {
  if (!line || line[0] === '#') continue;
  const [w, phIn, posIn] = line.trim().split(/\s+/);
  const pos = { v: 2, a: 4 }[posIn] || 1;
  if (!phIn || phIn === '=') {
    const ex = byWord.get(w);
    if (ex) { ex.forEach(e => { e.flags |= ARGOT; e.f = Math.max(e.f, 1); }); nTag++; }
    else argotLog.push('absent: ' + w);
    continue;
  }
  const ex = byWord.get(w);
  if (ex) for (const e of ex) E.delete(e.w + '|' + e.syll.replace(/-/g, ''));   // la prononciation argot prime
  const e = { w, syll: P.syllabify(phIn).join('-'), flags: pos | ARGOT, f: 3 };
  E.set(w + '|' + phIn, e); byWord.set(w, [e]); nArgot++;
}
console.log('Argot : +', nArgot, 'mots,', nTag, 'étiquetés.', argotLog.join(' ; '));

// 4. Tri + alias sans accents (etre -> être, ca -> ça, meme -> même…)
const all = [...E.values()];
all.sort((a, b) => a.w < b.w ? -1 : a.w > b.w ? 1 : b.f - a.f);
const words = new Set(all.map(e => e.w));
const deacc = w => w.normalize('NFD').replace(/[̀-ͯ]/g, '');
const alias = new Map();
for (const e of all) {
  const k = deacc(e.w);
  if (k === e.w || words.has(k) || e.f < 0.3) continue;
  const cur = alias.get(k);
  if (!cur || cur.f < e.f) alias.set(k, e);
}
const lines = all.map(e => e.w + '\t' + e.syll + '\t' + e.flags.toString(36) + bucket(e.f));
const aliasLines = [...alias.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([k, e]) => k + '\t=' + e.w);
fs.writeFileSync(new URL('../data/dict.txt', import.meta.url), lines.join('\n') + '\n#\n' + aliasLines.join('\n') + '\n');
console.log('Total :', lines.length, 'formes,', aliasLines.length, 'alias —', (fs.statSync(new URL('../data/dict.txt', import.meta.url)).size / 1e6).toFixed(2), 'Mo');
