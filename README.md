# Seize — carnet de rimes

Web app pour écrire des textes de rap. Elle fonctionne hors ligne et s'installe sur l'écran d'accueil (iPhone : Safari → Partager → « Sur l'écran d'accueil »).

- Coloration des rimes, assonances et allitérations (une couleur par son)
- Recherche de rimes avec filtres : syllabes, type de mot, fréquence, argot
- Dossiers, sections, historique des versions, mesures
- Export texte brut et PDF, avec ou sans couleurs
- Les textes restent sur l'appareil ; « Réglages et sauvegarde » permet d'exporter et d'importer une sauvegarde complète

## Organisation

| Dossier | Contenu |
| --- | --- |
| `js/phon.js` | prononciation, syllabes, alignement lettres/sons |
| `js/dict.js` | dictionnaire et recherche de rimes |
| `js/rhyme.js` | détection des rimes dans un texte |
| `js/app.js`, `js/store.js`, `js/export.js` | interface, stockage, exports |
| `data/dict.txt` | dictionnaire phonétique (267 000 formes) |
| `outils/` | script et liste d'argot qui produisent `data/dict.txt` |

Après une modification, changer `VERSION` dans `sw.js` pour que les appareils déjà installés récupèrent la mise à jour.

## Sources et licences

- Dictionnaire : [Lexique 3.83](http://www.lexique.org) (CC BY-SA 4.0), complété par [ipa-dict](https://github.com/open-dict-data/ipa-dict) (MIT) et une liste d'argot maison (`outils/argot.txt`). Le fichier `data/dict.txt` qui en dérive est sous CC BY-SA 4.0.
- PDF : [jsPDF](https://github.com/parallax/jsPDF) (MIT). Police : Bricolage Grotesque (SIL Open Font License).
