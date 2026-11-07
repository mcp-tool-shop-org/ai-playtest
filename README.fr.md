<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.md">English</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/ai-playtest/readme.png" alt="ai-playtest" width="400">
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/ai-playtest/actions/workflows/ci.yml"><img src="https://github.com/mcp-tool-shop-org/ai-playtest/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://mcp-tool-shop-org.github.io/ai-playtest/"><img src="https://img.shields.io/badge/Landing_Page-live-brightgreen" alt="Landing Page"></a>
</p>

# ai-playtest

Tests de jeu par IA, avec une diversité de familles, pour les jeux au tour par tour. Des modèles de joueurs font évoluer un jeu —
via un terminal, un pseudo-terminal ou une connexion socket vers votre moteur — un jury de
modèles provenant d’*autres* familles évalue chaque transcription, et un rapport regroupe les
jugements, en indiquant également la part du jeu que chaque session a réellement explorée.

Une seule partie jouée par une seule personne vous indique ce qu’une seule personne a vu. Cinq familles
jouant aux mêmes quarante tours vous indiquent ce que le monde fait.

Version 1.0.0. Disponible publiquement sur GitHub. Pas encore sur npm — clonez-le, ou utilisez-le en spécifiant le chemin vers un dépôt frère.

## Qui juge ?

La première chose à savoir, car c’est ce que la plupart de ces outils font mal : **un
joueur ne peut pas évaluer sa propre partie.** Chaque transcription est évaluée par un seul évaluateur externe par défaut (`panelSize`, augmentez-le pour signaler un désaccord — pas pour obtenir un score moyen plus élevé), et l’évaluation du joueur est conservée comme *témoignage* —
pour indiquer où il a été confus, ce qu’il a essayé — jamais comme le score.

Cette distinction est essentielle. La plupart des mesures de l’auto-préférence chez les évaluateurs LLM
s’avèrent être une question de compétence plutôt que de narcissisme (seulement environ 10,4 % dépassent un contrôle correspondant en termes de capacités sur 37 448 paires — [Roytburg et al.
2026](https://arxiv.org/html/2601.22548)), **mais le reste se concentre dans les
domaines subjectifs et disparaît dans les domaines vérifiables** — et « le monde semble-t-il vivant ? » est une question aussi subjective que possible. Parallèlement, l’auto-critique diminue activement la précision là où un vérificateur externe l’augmente : Game-of-24 passe de 5 % à 3 % lorsqu’il est auto-évalué, et à 38 % avec un vérificateur fiable ([Stechly et al.
2024](https://arxiv.org/abs/2402.08115)).

Par défaut, il y a **un seul évaluateur externe**, et non un panel de trois évaluateurs. [Verga et al.
2024](https://arxiv.org/abs/2404.18796) (PoLL) ont montré qu’un panel hétérogène peu coûteux obtenait de meilleurs résultats que GPT-4 en termes d’accord entre les humains, avec un coût 7 à 8 fois inférieur (κ 0,763 contre 0,627) —
c’est un argument contre le fait de payer pour un seul évaluateur *important*, et non un argument selon lequel trois familles donneraient trois votes indépendants. [Kohli
2026](https://arxiv.org/abs/2605.29800) a mesuré neuf évaluateurs provenant de sept
familles chez Kish, avec **n_eff = 2,18** ; le panel (72,0 %) n’a *pas* surpassé le meilleur évaluateur unique (71,8 %) ; la corrélation inter-familles était de 0,389 contre 0,437 pour les mêmes familles. Sur `panelSize: 3`, cela représente **≈1,68 vote indépendant**. La méthode Dawid-Skene ne permet pas d’améliorer ce résultat (≤11 % de l’écart de Condorcet). [Kim et al. 2025](https://arxiv.org/abs/2506.07962)
ont constaté que les paires étaient d’accord environ 60 % du temps lorsqu’elles avaient toutes les deux tort. Ainsi, des évaluateurs supplémentaires servent à signaler un désaccord, et non à obtenir un score plus élevé. **Le budget est déplacé des évaluateurs vers le nombre de parties.**
`--runs 3` est descriptif, et non un test de signification ; la ligne de commande continue de par défaut à une seule partie, de sorte qu’une partie de test reste une seule tentative. n = 3 ne peut jamais atteindre p < 0,05 (seuil `2/2^n` = 0,25). Voir `docs/research-2.md` §A et `docs/research-3.md`.

Cela ne permet **pas** d’annuler le fait de retirer l’auteur de son propre jury, ce qui repose sur
Panickssery / Stechly / Huang.

**Le désaccord est signalé, et non moyenné.** Un verdict partagé signifie généralement que le
*critère* est insuffisamment défini, et non que le jeu est ambigu, de sorte que les partages sont
marqués avec leur nombre et la dispersion de chaque joueur est affichée.

Si une seule famille est présente, il n’y a pas d’évaluateur valide. L’outil ne renvoie pas silencieusement
la transcription à son auteur — il ne forme pas de jury, et le rapport indique que le verdict est auto-évalué et explique pourquoi cela est faible. La validation de la configuration refuse toujours de placer deux joueurs d’une même famille : une deuxième famille est ce qui rend possible un jury d’évaluateurs externes ([Panickssery et al. 2024](https://arxiv.org/abs/2404.13076)).

## Pilotes — comment le jeu est observé

| pilote | canal | pour |
|---|---|---|
| `stdio` | lignes | jeux de texte orientés ligne (par défaut) |
| `pty` | une grille de terminal rendu | interfaces utilisateur en mode texte en plein écran (ratatui, ncurses) |
| `rpc` | état structuré via TCP | Godot, Unreal, tout ce que vous pouvez instrumenter |

L’ordre est basé sur le degré de *structure* du canal, et c’est intentionnel plutôt qu’une question de goût. Les observations de l’arbre d’accessibilité doublent approximativement le succès des observations basées uniquement sur des captures d’écran sur [OSWorld](https://arxiv.org/abs/2404.07972) (12,24 % contre
5,26 %) ; sur [BALROG](https://arxiv.org/abs/2411.13543), l’*ajout* de la vision a directement diminué les performances de plusieurs modèles (GPT-4o 32,34 % → 22,56 %) ; les jeux basés sur des pixels non structurés atteignent un score proche de zéro sur [VideoGameBench](https://arxiv.org/abs/2505.18134) (0,48 % de complétion du jeu) ; et [Voyager](https://arxiv.org/abs/2305.16291), toujours l’agent de jeu open-ended le plus performant, utilise une API structurée et n’a jamais vu un pixel.

Ainsi, une capture d’écran est une *pièce jointe* facultative à une observation, et non le seul canal. **Si votre jeu peut se décrire lui-même, il devrait le faire** — voir
[docs/engine-bridge.md](docs/engine-bridge.md) pour un exemple Godot 4 que vous pouvez copier-coller, où `_observation()` et `_apply()` sont les seules fonctions que vous devez écrire,
plus le routage Unreal.

### Pourquoi `pty` est important, même pour les jeux de texte

Dans un pipe, la sortie standard d’un programme C est entièrement mise en mémoire tampon, de sorte que « la sortie est devenue silencieuse pendant N ms » peut signifier « n’a pas encore vidé la mémoire tampon », plutôt que « attend que vous fassiez quelque chose ». Un PTY restaure la mise en mémoire tampon par ligne et rend la règle de disponibilité plus fiable. Sous Windows, un pipe ne capture rien d’un jeu qui dessine via l’API Console.

Cela corrige également l’apparence d’un redessin. Mesuré sur l’interface utilisateur de test : la grille contient
**115 caractères d’un seul écran actuel**, tandis que la vue d’ajout de ligne contient **416
caractères** de trois redessins empilés, avec l’entrée du joueur affichée et *trois valeurs de points de vie contradictoires*. Le modèle doit deviner laquelle est correcte.

`pty` a besoin des bibliothèques facultatives `node-pty` et `@xterm/headless`. Elles s’installent automatiquement sous Windows et macOS ; node-pty se compile sous Linux. Sans elles, ce pilote échoue avec une erreur codée indiquant la commande d’installation — rien d’autre n’est affecté.

## Dans quelle mesure chaque joueur a-t-il réellement joué ?

Un joueur IA qui n’explore pas produit un rapport confiant sur un jeu qu’il a à peine regardé. Chaque partie comporte donc un bloc de couverture calculé à partir des enregistrements de tours seuls — aucune instrumentation, aucun appel de modèle supplémentaire : la courbe de nouveauté et la demi-vie, les taux de répétition / boucle / auto-boucle, l’entropie des actions et une simple
lecture `thin` / `moderate` / `broad` avec les raisons.

Il est intéressant de l’utiliser car l’échec est mesuré, et non théorique.
Les agents LLM axés sur les tâches répètent leur action précédente dans **63,4 %** des cas, avec un taux de boucle de 16,0 %, contre 24,9 % / 7,7 % pour les agents *entraînés* à l’exploration ([Ye et al. 2026](https://arxiv.org/html/2605.16143)). Interprétez cela comme la plage dans laquelle se situe réellement la répétition de l’agent, et non comme quelque chose qu’une chaîne de personnalité permettrait, car le simple fait de demander à un agent d’explorer ne vaut que **+2,57** en moyenne pour le taux de réussite à 1 ([Englander et al. 2026](https://arxiv.org/html/2604.17609)). Une faible entropie d’action indique également une *faible* réussite plutôt qu’une efficacité. Par conséquent, un enregistrement clair avec peu d’entrées distinctes est un signe avant-coureur, et non un signe positif.

## Comment interpréter un verdict

**Le classement est important ; ne vous fiez pas aux scores absolus.** Il s’agit de la mise en garde la plus importante de l’outil, et elle découle de deux sources indépendantes. Les juges LLM évaluant la qualité narrative atteignent un niveau τ ≈ 0,70, contre un seuil humain de 0,73, mais le niveau τ au niveau de l’histoire n’est que de 0,16 à 0,25, ce qui est à peine supérieur à BERTScore ([Chhun et al. 2024](https://arxiv.org/abs/2405.13769)). Les tests automatisés confirment la même chose : les taux de réussite de l’IA correspondent aux taux de réussite humains, avec un ρ = 0,80 pour 95 266 joueurs ([Roohi et al. 2021](https://arxiv.org/abs/2107.12061)), tandis que les compétences absolues de l’agent ne sont pas du tout transférables.

Ainsi, « le modèle B a obtenu un score inférieur à celui du modèle A pour *réagit aux actions du joueur* » est une affirmation que cet outil prend en charge. « Ce jeu est vivant : oui » n’est pas une affirmation que cet outil prend en charge, et le rapport est rédigé de manière à ce que cette distinction reste visible.

**Une lacune connue, clairement énoncée :** aucune étude que nous ayons pu trouver ne mesure l’accord entre les problèmes détectés par les testeurs d’agents et les problèmes détectés par les testeurs humains *en ce qui concerne la qualité de l’expérience*. Les tests automatisés sont validés uniquement en fonction de la difficulté et de la compétence. La prémisse centrale de l’outil — selon laquelle les confusions d’un modèle ressemblent à celles d’un joueur — n’a donc pas été testée dans la littérature, dans un sens ou dans l’autre. Considérez les points faibles et les confusions comme des pistes à vérifier, et non comme des conclusions.

## Comment cela fonctionne

1. **Observer.** Le pilote produit un `Observation` : toujours `text`, éventuellement un `grid` terminal, une structure `state`, une pièce jointe `image` et les `actions` qui sont autorisées pour le moment. Il enregistre également *comment* il a su que c’était au tour du joueur — un signal envoyé par le jeu, un signal de prêt terminal, un modèle d’invite ou une supposition de calme — afin que vous puissiez distinguer la connaissance de l’inférence.
2. **Configuration scriptée.** Les invites correspondant à une expression régulière `setup[].match` sont traitées à partir de la configuration, sans l’intervention du joueur et sans consommer de tour, de sorte que chaque famille commence avec le même personnage.
3. **Le joueur** voit l’écran depuis sa dernière entrée, ainsi que ses dernières `playerMemoryTurns` interactions, et reçoit des informations de `persona` (objectifs et registre — jamais les mécanismes testés), puis répond en une seule ligne. Les réponses malformées sont ramenées à `look`.
4. **Agir.** Lorsque l’observation contient `actions`, la réponse nettoyée est mappée sur `choose` / `key` / `line`. Une erreur dans un ensemble fermé est un événement du harnais — le programme ne consomme pas de tour de jeu pour cela. La configuration et la sortie restent `kind:line`.
5. **Quitter.** Après `turns` entrées, le programme envoie `quitInputs` (par exemple, `save`, `quit`). Ce sont les entrées du *programme* : elles sont exclues du nombre de tours et des preuves, tandis que les écrans terminaux qu’elles produisent sont conservés — un plantage ou un résumé de sauvegarde constitue une preuve.
6. **Le jury** — un siège d’auteur désactivé par défaut, avec une température de 0 — évalue le transcript par rapport à `criteria[]`. Les jurés supplémentaires (si `panelSize` > 1) signalent les désaccords ; ils ne sont pas pris en compte pour obtenir un score plus élevé. L’évaluation du siège du joueur constitue un témoignage.
7. **Des vérifications déterministes** sont effectuées sur les enregistrements des tours : SCC absorbant (Tarjan, jamais étiqueté comme un piège), attribution des entrées ignorées, expressions régulières facultatives pour l’analyseur/la victoire/la mort, fenêtres sans progrès, pistes d’apparition d’entités et (lorsque `state` est un objet) invariants de PV/inventaire.
8. **Le rapport** agrège : critères par famille avec les divergences des jurés indiquées, couverture en tant que qualificateur d’échantillonnage, le bloc de vérification et chaque point faible et chaque confusion nommés — les conclusions du jury en premier, le témoignage de l’auteur conservé. Les glyphes (`!`, `H(a)`, `repeat`, `loop`) sont accompagnés d’une légende sur la page.

Artefacts par siège sous `<runsDir>/<label>/<seat>/` : `transcript.txt`, `critique.json`, `meta.json` (épingles `schemaVersion` + `toolVersion`), `stderr.txt` (lorsque le jeu a écrit quoi que ce soit). `REPORT.md` et `REPORT.json` (`kind: "single-run-report"`) à la racine de l’étiquette.

## Utilisation

```bash
export OPENROUTER_API_KEY=...
npm run build
node dist/cli.js run path/to/game.playtest.json --label phase9
node dist/cli.js run path/to/game.playtest.json --label smoke --seats mistral --turns 8
node dist/cli.js run path/to/game.playtest.json --label compare --runs 3   # descriptive; cannot reach p<0.05
node dist/cli.js run path/to/game.playtest.json --label rpc --serial       # one game, several seats; needed for RPC until you multiplex
node dist/cli.js report path/to/game.playtest.json --label phase9   # rebuild REPORT.md + REPORT.json from disk
```

`--serial` exécute les sièges l’un après l’autre. Sur le pilote RPC, il réutilise un seul client TCP et appelle `reset()` entre les sièges. Sans `--serial`, chaque siège RPC est son propre processus — ils entreront en conflit s’ils partagent un jeu d’écoute.

Codes de sortie : 0 ok · 1 utilisation · 2 configuration · 3 fournisseur (clé manquante, le modèle n’a pas de points de terminaison) · 4 erreur d’exécution (chaque siège s’est terminé par une erreur, ou aucun siège n’a produit de verdict). Les erreurs affichent `error:` et `hint:`.

## Référence de configuration

| clé | signification |
|---|---|
| `name` | nom du test (titre du rapport) |
| `driver` | `{"kind":"stdio"}` (par défaut), `{"kind":"pty","cols":100,"rows":30,"readySentinel":"..."}` ou `{"kind":"rpc","port":7777,"host":"127.0.0.1"}` |
| `game.command`, `game.args`, `game.cwd` | comment lancer le jeu ; `cwd` se résout par rapport au fichier de configuration. Pour `rpc`, définissez `command` et `run`, qui lit `PLAYTEST_BRIDGE_PORT=` à partir du processus (ce port a la priorité sur `driver.port`). Laissez `command` vide pour vous connecter à un jeu qui est déjà en écoute. Deux sièges ou plus avec une commande nécessitent `--serial` |
| `game.env` | variables d’environnement supplémentaires pour le jeu ; une valeur `$NAME` lit les variables d’environnement du programme |
| `game.inheritEnv` | transmettre l’ensemble des variables d’environnement du programme au jeu. **Désactivé par défaut** — voir ci-dessous |
| `game.promptPatterns` | expressions régulières signifiant « en attente d’une ligne », testées par rapport à la fin tronquée (`stdio`) ou à la ligne de curseur rendue (`pty`) |
| `game.promptQuietMs` / `idleQuietMs` / `screenTimeoutMs` | la règle d’attente (par défaut 800 / 6000 / 180 000 ms) |
| `game.quitInputs` | lignes envoyées après le dernier tour (par défaut `["quit"]`) |
| `seats[]` | `{ id, family, model }` — OpenRouter slugs ; un siège par famille |
| `panelSize` | nombre de jurés désactivés pour l’auteur par transcript (par défaut **1** ; augmentez pour signaler un désaccord, et non pour obtenir un score plus élevé) |
| `verifiers` | listes d’expressions régulières facultatives (`unparsed`, `refused`, `victory`, `death` ; vide = ne pas deviner). Occupation : `absorbingMinTurns` (par défaut 4), `noProgressWindow` (par défaut 5), `noOpVerbs` |
| `setup[]` | `{ match, answer }` réponses scriptées pour les invites de configuration |
| `turns` | entrées de jeu par siège (les réponses de configuration et les entrées de sortie ne sont pas comptabilisées ; par défaut 40) |
| `persona` | le résumé du joueur |
| `criteria[]` | `{ id, check }`, les critères d’activité propres au jeu |
| `screenChars` | nombre de personnages à l’écran maintenus par tour (par défaut : 6 000) |
| `playerMemoryTurns` | nombre de tours récentes que le joueur voit (par défaut : 8) |
| `playerTemperature` | température d’échantillonnage du joueur (par défaut : 0,7) ; le critique est toujours à 0 |
| `runsDir` | emplacement où les exécutions sont enregistrées (par défaut : `runs`, résolu par rapport au fichier de configuration) |

Une configuration fonctionnelle : `claude-rpg/dogfood/playtest/claude-rpg.playtest.json` (l’exécutable Claude, utilisé pour les tests, effectue des exécutions via l’endpoint compatible Anthropic de OpenRouter — `ANTHROPIC_BASE_URL=https://openrouter.ai/api`, l’application SDK ajoute `/v1/messages` — avec le remplacement `CLAUDE_RPG_MODEL` du jeu, qui définit un identifiant `anthropic/...`).

### Note sur `game.inheritEnv`

Le processus du jeu reçoit une petite liste d’autorisations, ainsi que votre `game.env`, et **pas** `OPENROUTER_API_KEY`. Ce n’était pas toujours le cas : auparavant, la clé était transmise au jeu et affichée sous forme de texte à l’écran, d’où elle était transmise au contexte du joueur et au rapport écrit. Si vous avez des exécutions antérieures à cette correction, considérez que la clé utilisée pour celles-ci est accessible. `inheritEnv: true` rétablit l’héritage complet : utilisez-le uniquement pour un jeu auquel vous faites autant confiance qu’à l’exécutable lui-même.

Voir [SECURITY.md](SECURITY.md) pour la description complète.

## Modèle de confiance

**Données concernées :** le fichier JSON du test, tout ce que `game.command` / le pont RPC affiche, OpenRouter réponses de chat (joueur + jury) et les fichiers que l’exécutable enregistre dans `runsDir` (`transcript.txt`, `critique.json`, `meta.json`, `REPORT.md`, `REPORT.json`).

**Données non concernées :** l’exécutable n’envoie aucune télémétrie et ne collecte aucune donnée analytique. Le processus du jeu ne reçoit pas `OPENROUTER_API_KEY`, sauf si vous définissez `game.inheritEnv: true`. Rien n’est écrit en dehors de `runsDir`.

**Autorisations :** `game.command` est `child_process.spawn` : une configuration de test est équivalente à un exécutable. Examinez-la comme vous le feriez pour un script shell. La communication HTTPS sortante est uniquement l’URL de base OpenRouter configurée. Il n’y a pas de bac à sable.

## Télémétrie

Aucune. Aucune donnée analytique, aucun rapport d’erreur, aucune communication vers un serveur distant. La seule communication réseau est celle que vous avez configurée pour les modèles.

## Conformité aux normes (normes de flux de travail, score de 0 à 3)

- **PIN_PER_STEP — 2.** Chaque participant associe son identifiant de modèle ; les invites du joueur et du critique sont des constantes de code ; la configuration est l’entrée reproductible. OpenRouter n’associe pas le routage du fournisseur, de sorte qu’une reproduction est identique en termes d’invite, et non en termes d’octets. *Correction : enregistrer le fournisseur choisi pour chaque appel dans `meta.json`.*
- **ANDON_AUTHORITY — 2.** Un participant qui se bloque (`screenTimeoutMs`), qui quitte prématurément ou qui épuise ses tentatives se termine avec une raison enregistrée ; une exécution où aucun participant n’a produit de verdict se termine avec le code 4 au lieu de 0, de sorte qu’un échec de critique silencieux ne peut pas être interprété comme un succès.
- **NAMED_COMPENSATORS — ignoré :** le seul artefact de l’exécutable est le répertoire d’exécution ; sa suppression annule tout. Les effets secondaires du *jeu* lui appartiennent et sont indépendants du contrôle de l’exécutable, ce qui explique pourquoi une configuration de test est traitée comme un exécutable.
- **DECOMPOSE_BY_SECRETS — 3.** `driver.ts` est la limite d’observation, `openrouter.ts` la seule limite de réseau, `panel.ts` la limite d’évaluation ; chacun a ses propres tests et une version simulée de l’autre côté.
- **UNCERTAINTY_GATED_HUMANS — 3.** Le rapport agrège mais ne tranche jamais, et il indique sa propre incertitude : les verdicts partagés, la couverture limitée, un avertissement sur un échantillon unique et les critères auxquels aucun juge n’a répondu sont tous affichés plutôt que lissés.
- **EXTERNAL_VERIFIER — 3.** Chaque transcription est évaluée par une famille qui ne l’a pas produite (par défaut, un participant avec un seul auteur ; augmentez `panelSize` pour signaler un désaccord), et le désaccord est signalé. **Ce score était de 3 alors que le code faisait le contraire** jusqu’à l’échantillon du 14 septembre 2026 : le critique était le même modèle que celui qui jouait. L’affirmation correspond désormais à l’implémentation, et `pickJurors` renvoie un jury vide plutôt que de revenir à l’auteur.

## Développement

```bash
npm install
npm run verify      # typecheck (src AND tests) + vitest
npm run coverage    # vitest --coverage
```

182 tests. `tsconfig.test.json` existe parce que la configuration de la compilation exclut les fichiers de test, ce qui signifiait qu’aucun fichier de test n’était vérifié par un quelconque processus : il a détecté de véritables erreurs de type lors de sa première exécution.

---

Créé par [MCP Tool Shop](https://mcp-tool-shop.github.io/).
