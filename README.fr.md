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

# test d’IA

Tests d’IA avec une diversité de familles pour les jeux au tour par tour. Des joueurs modèles font évoluer un jeu —
via un terminal, un pseudo-terminal ou une connexion socket vers votre moteur — un jury de
modèles provenant d’*autres* familles évalue chaque transcription, et un rapport regroupe les
verdicts ainsi que la quantité de jeu réellement observée par chaque session.

Une seule partie jouée par une seule personne vous indique ce qu’une seule personne a vu. Cinq familles
jouant aux mêmes quarante tours vous indiquent ce que le monde fait.

**Privé jusqu’à ce que ce soit approprié.** Pas sur npm ; utilisé via un chemin à partir de référentiels frères.

## Qui juge

La première chose à savoir, car c’est ce que la plupart de ces outils font mal : **un
joueur ne peut pas évaluer sa propre partie.** Chaque transcription est évaluée par un seul évaluateur
(`panelSize`, augmentez-le pour indiquer un désaccord — et non pour obtenir un score plus élevé), et l’évaluation
du joueur est conservée comme *témoignage* —
où il a été confus, ce qu’il a essayé — jamais comme le score.

Cette distinction est essentielle. La plupart des préférences de soi mesurées chez les évaluateurs de LLM
s’avèrent être de la compétence plutôt que du narcissisme (seulement environ 10,4 % dépassent un
contrôle correspondant en termes de capacités sur 37 448 paires — [Roytburg et al.
2026](https://arxiv.org/html/2601.22548)), **mais le reste se concentre dans
les domaines subjectifs et disparaît dans les domaines vérifiables** — et « le monde semble-t-il
vivant ? » est une question aussi subjective que possible. Pendant ce temps, l’autocritique diminue
activement la précision là où un vérificateur externe l’augmente : Game-of-24 passe de 5 % à 3 %
avec une autocritique et à 38 % avec un vérificateur fiable ([Stechly et al.
2024](https://arxiv.org/abs/2402.08115)).

Par défaut, il y a **un seul évaluateur**, et non un panel de trois évaluateurs. [Verga et al.
2024](https://arxiv.org/abs/2404.18796) (PoLL) a montré qu’un panel hétérogène peu coûteux surpasse
GPT-4 en termes d’accord humain à un coût 7 à 8 fois inférieur (κ 0,763 contre 0,627) —
c’est un argument contre le fait de payer pour un seul évaluateur *important*, et non un argument
selon lequel trois familles donnent trois votes indépendants. [Kohli
2026](https://arxiv.org/abs/2605.29800) a mesuré neuf évaluateurs dans sept
familles chez Kish **n_eff = 2,18** ; le panel (72,0 %) n’a *pas* surpassé le meilleur
évaluateur unique (71,8 %) ; la corrélation inter-familles était de 0,389 contre 0,437 pour la même famille.
Avec `panelSize: 3`, cela représente **≈1,68 vote indépendant**. La méthode Dawid-Skene ne résout pas
le problème (≤11 % de l’écart de Condorcet). [Kim et al. 2025](https://arxiv.org/abs/2506.07962)
ont constaté que les paires sont d’accord environ 60 % du temps lorsque les deux ont tort. Ainsi, des
jurés supplémentaires sont un indicateur de désaccord, et non un score plus élevé. **Le budget est
déplacé des évaluateurs vers les parties.** `--runs 3` est descriptif, et non un test de signification ; la CLI
utilise toujours une seule partie par défaut, de sorte qu’une partie de test reste une seule tentative.
n=3 ne peut jamais atteindre p<0,05 (seuil `2/2^n` = 0,25). Voir `docs/research-2.md` §A et `docs/research-3.md`.

Cela ne supprime pas le fait de retirer l’auteur de son propre jury, ce qui repose sur
Panickssery / Stechly / Huang.

**Le désaccord est signalé, et non moyenné.** Un verdict partagé signifie généralement que le
*critère* est insuffisamment défini, et non que le jeu est ambigu, de sorte que les partages sont
marqués avec leur nombre et la dispersion de chaque joueur est affichée.

Si une seule famille est présente, il n’y a pas de juré valide. L’outil ne renvoie pas discrètement
la transcription à son auteur ; il ne forme pas de jury, et le rapport indique que le verdict est
auto-évalué et explique pourquoi cela est faible. La validation de la configuration refuse toujours
de placer deux joueurs de la même famille : une deuxième famille est ce qui rend possible un jury
d’évaluateurs ([Panickssery et al. 2024](https://arxiv.org/abs/2404.13076)).

## Pilotes — comment le jeu est observé

| pilote | canal | pour |
|---|---|---|
| `stdio` | lignes | jeux de texte orientés ligne (par défaut) |
| `pty` | une grille de terminal rendu | interfaces utilisateur en mode texte en plein écran (ratatui, ncurses) |
| `rpc` | état structuré via TCP | Godot, Unreal, tout ce que vous pouvez instrumenter |

L’ordre est basé sur le degré de *structure* du canal, et c’est délibéré plutôt qu’une question de goût.
Les observations de l’arbre d’accessibilité doublent approximativement le succès des observations
uniquement basées sur des captures d’écran dans [OSWorld](https://arxiv.org/abs/2404.07972) (12,24 % contre
5,26 %) ; dans [BALROG](https://arxiv.org/abs/2411.13543), *l’ajout* de la vision a directement
dégradé plusieurs modèles (GPT-4o 32,34 % → 22,56 %) ; les jeux basés sur des pixels non structurés
obtiennent des résultats proches de zéro dans [VideoGameBench](https://arxiv.org/abs/2505.18134) (0,48 %
de complétion du jeu) ; et [Voyager](https://arxiv.org/abs/2305.16291), toujours l’agent de jeu
le plus performant en monde ouvert, utilisait une API structurée et n’a jamais vu de pixel.

Ainsi, une capture d’écran est une *pièce jointe* facultative à une observation, et non le seul canal.
**Si votre jeu peut se décrire, il devrait le faire** — voir
[docs/engine-bridge.md](docs/engine-bridge.md) pour un code Godot 4 prêt à être copié et collé, où `_observation()` et `_apply()`
sont les seules fonctions que vous devez écrire, ainsi que le routage Unreal.

### Pourquoi `pty` est important, même pour les jeux de texte

Dans un pipe, la sortie standard d’un programme C est entièrement mise en mémoire tampon, de sorte que
« la sortie est devenue silencieuse pendant N ms » peut signifier « n’a pas encore vidé la mémoire tampon »,
et non « attend que vous fassiez quelque chose ». Un PTY restaure la mise en mémoire tampon par ligne
et rend la règle de disponibilité plus fiable. Sous Windows, un pipe ne capture rien d’un jeu qui
dessine via l’API Console.

Cela corrige également l’apparence d’un redessin. Mesuré sur l’interface utilisateur de test : la grille
contient **115 caractères d’un écran actuel**, tandis que la vue d’ajout de ligne contient **416
caractères** de trois redessins empilés avec l’entrée du joueur affichée et *trois valeurs de PV contradictoires*.
Le modèle doit deviner laquelle est active.

`pty` a besoin des `node-pty` et `@xterm/headless` facultatifs. Ils s’installent sur Windows et macOS ; node-pty se compile
sous Linux. Sans eux, ce pilote échoue avec une erreur codée indiquant la commande d’installation —
rien d’autre n’est affecté.

## La quantité de jeu réellement observée par chaque joueur

Un modèle d’agent qui n’explore pas produit un rapport positif sur un jeu auquel il
n’a pratiquement pas joué. Chaque exécution comprend donc un bloc de couverture calculé à partir des
enregistrements de tours uniquement — aucune instrumentation, aucun appel de modèle supplémentaire : la courbe de nouveauté
et la demi-vie, les taux de répétition/boucle/auto-boucle, l’entropie des actions, et une simple
`thin` / `moderate` / `broad` avec les raisons.

Cela vaut la peine, car l’échec est mesuré, et non théorique.
Les agents LLM orientés tâches répètent leur action précédente dans **63,4 %** des cas, avec un
taux de boucle de 16,0 %, contre 24,9 % / 7,7 % pour les agents *entraînés* à l’exploration ([Ye
et al. 2026](https://arxiv.org/html/2605.16143)). Interprétez cela comme la plage dans laquelle se situe réellement la répétition de l’agent, et non comme quelque chose qu’une chaîne de personnalité permettrait, car le simple fait de demander à un agent d’explorer ne vaut que **+2,57** en moyenne pour le taux de réussite@1
([Englander et al. 2026](https://arxiv.org/html/2604.17609)). Une faible entropie des actions
indique également une *faible* réussite plutôt qu’une efficacité, de sorte qu’un enregistrement clair avec peu
d’entrées distinctes est un signe avant-coureur, et non un signe positif.

## Comment interpréter un verdict

**Les classements sont importants ; ne vous fiez pas aux scores absolus.** Il s’agit de la mise en garde la plus importante
dans cet outil, et elle découle de deux sources indépendantes. Les juges LLM évaluant la
qualité narrative atteignent un niveau τ ≈ 0,70, contre un seuil humain de 0,73, mais le niveau τ pour chaque histoire n’est que de 0,16 à 0,25 — à peine supérieur à BERTScore ([Chhun et al.
2024](https://arxiv.org/abs/2405.13769)). Les tests automatisés confirment la même chose : les taux de réussite de l’IA correspondent aux taux de réussite humains avec ρ = 0,80 pour 95 266 joueurs
([Roohi et al. 2021](https://arxiv.org/abs/2107.12061)), tandis que les compétences absolues de l’agent ne sont pas du tout transférables.

Ainsi, « la version B a obtenu un score inférieur à la version A pour *réagit-au-joueur* » est une affirmation que cet outil prend en charge. « Ce jeu est vivant : oui » n’est pas une affirmation que cet outil prend en charge, et le rapport est rédigé de manière à maintenir cette distinction visible.

**Une lacune connue, clairement énoncée :** aucune étude que nous ayons pu trouver ne mesure l’accord
entre les problèmes détectés par les testeurs d’agents et les problèmes détectés par les testeurs humains
*en ce qui concerne la qualité de l’expérience*. Les tests automatisés sont validés uniquement en fonction de la difficulté
et de la compétence. Le principe central de l’outil — selon lequel les confusions d’un modèle
ressemblent à celles d’un joueur — n’est donc pas testé dans la littérature, dans un sens ou dans l’autre. Considérez
les points faibles et les confusions comme des pistes à vérifier, et non comme des conclusions.

## Comment cela fonctionne

1. **Observer.** Le pilote produit un `Observation` : toujours `text`, éventuellement un
`grid` terminal, structuré `state`, une pièce jointe `image` et les `actions`
qui sont autorisés pour le moment. Il enregistre également *comment* il savait que c’était le tour du joueur — un signal envoyé par le jeu, un signal de prêt terminal, un modèle d’invite ou
une supposition de calme — afin que vous puissiez distinguer la connaissance de l’inférence.
2. **Configuration scriptée.** Les invites correspondant à une expression régulière `setup[].match` sont traitées à partir
de la configuration, sans le joueur et sans consommer de tour, de sorte que chaque famille
commence avec le même personnage.
3. **Le joueur** voit l’écran depuis sa dernière entrée, ainsi que ses dernières
`playerMemoryTurns` interactions, et reçoit des informations de `persona` (objectifs et registre —
jamais les mécanismes testés), et répond en une seule ligne. Les réponses malformées
reviennent à `look`.
4. **Agir.** Lorsque l’observation contient `actions`, la réponse nettoyée est mappée sur
`choose` / `key` / `line`. Une erreur dans un ensemble fermé est un événement du harnais — le programme
ne consomme pas de tour de jeu pour cela. La configuration et la sortie restent `kind:line`.
5. **Quitter.** Après `turns` entrées, le programme envoie `quitInputs` (par exemple, `save`,
`quit`). Ce sont les entrées du *programme ;* elles sont exclues du nombre de tours
et des preuves, tandis que les écrans terminaux qu’elles produisent sont conservés — un plantage ou un résumé de sauvegarde constitue une preuve.
6. **Le jury** — un seul participant qui n’est pas l’auteur par défaut, avec une température de 0 — évalue
l’enregistrement par rapport à `criteria[]`. Les jurés supplémentaires (si `panelSize` > 1) signalent
les désaccords ; ils ne sont pas pris en compte dans un score plus élevé. La propre évaluation du participant est un témoignage.
7. **Des vérifications déterministes** sont effectuées sur les enregistrements de tours : SCC absorbant (Tarjan, jamais étiqueté comme un piège), attribution d’entrée ignorée, expressions régulières facultatives pour le parseur/victoire/mort, fenêtres sans progrès, pistes d’apparition d’entités et (lorsque `state` est
un objet) invariants de PV/inventaire.
8. **Le rapport** agrège : critères par famille avec les divergences des jurés indiquées, couverture en tant que qualificateur d’échantillonnage, le bloc de vérification et chaque point faible et chaque confusion nommés — les conclusions du jury en premier, le témoignage de l’auteur conservé. Les glyphes
(`!`, `H(a)`, `repeat`, `loop`) sont expliqués dans la légende de la page.

Artefacts par participant sous `<runsDir>/<label>/<seat>/` : `transcript.txt`,
`critique.json`, `meta.json` (épingles `schemaVersion` + `toolVersion`),
`stderr.txt` (lorsque le jeu a écrit quoi que ce soit). `REPORT.md` et `REPORT.json`
(`kind: "single-run-report"`) à la racine de l’étiquette.

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

`--serial` exécute les participants l’un après l’autre. Sur le pilote RPC, il réutilise un seul client TCP
et appelle `reset()` entre les participants. Sans `--serial`, chaque participant RPC
est son propre processus — ils entreront en conflit s’ils partagent un seul jeu d’écoute.

Codes de sortie : 0 ok · 1 utilisation · 2 configuration · 3 fournisseur (clé manquante, le modèle n’a pas d’endpoints) · 4 erreur d’exécution (chaque participant s’est terminé par une erreur, ou aucun participant n’a produit de verdict). Les erreurs affichent `error:` et `hint:`.

## Référence de la configuration

| clé | signification |
|---|---|
| `name` | nom du test (titre du rapport) |
| `driver` | `{"kind":"stdio"}` (par défaut), `{"kind":"pty","cols":100,"rows":30,"readySentinel":"..."}` ou `{"kind":"rpc","port":7777,"host":"127.0.0.1"}` |
| `game.command`, `game.args`, `game.cwd` | comment lancer le jeu ; `cwd` se résout par rapport au fichier de configuration. Inutile pour le pilote `rpc`, qui se connecte à un jeu en cours d’exécution |
| `game.env` | variables d’environnement supplémentaires pour le jeu ; une valeur `$NAME` lit les variables d’environnement du programme |
| `game.inheritEnv` | transmet l’ensemble des variables d’environnement du programme au jeu. **Désactivé par défaut** — voir ci-dessous |
| `game.promptPatterns` | expressions régulières signifiant « en attente d’une ligne », testées par rapport à la fin supprimée (`stdio`) ou à la ligne du curseur rendue (`pty`) |
| `game.promptQuietMs` / `idleQuietMs` / `screenTimeoutMs` | la règle d’attente (par défaut : 800 / 6 000 / 180 000 ms) |
| `game.quitInputs` | lignes envoyées après le dernier tour (par défaut : `["quit"]`) |
| `seats[]` | `{ id, family, model }` — Identifiants OpenRouter ; une place par famille |
| `panelSize` | nombre de jurés « auteur désactivé » par transcription (par défaut : 1 ; augmenter pour signaler un désaccord, et non pour obtenir un score plus élevé) |
| `verifiers` | listes d’expressions régulières facultatives (`unparsed`, `refused`, `victory`, `death` ; vide = ne pas deviner). Occupation : `absorbingMinTurns` (par défaut : 4), `noProgressWindow` (par défaut : 5), `noOpVerbs` |
| `setup[]` | `{ match, answer }` : réponses scriptées pour les invites de configuration |
| `turns` | entrées de jeu par place (les réponses de configuration et les entrées de fin ne sont pas prises en compte ; par défaut : 40) |
| `persona` | bref résumé du jeu |
| `criteria[]` | `{ id, check }` : les propres critères de survie du jeu |
| `screenChars` | nombre de caractères de l’écran conservés par tour (par défaut : 6 000) |
| `playerMemoryTurns` | nombre de tours récents que le joueur voit (par défaut : 8) |
| `playerTemperature` | température d’échantillonnage du joueur (par défaut : 0,7) ; le critique est toujours à 0 |
| `runsDir` | emplacement où les exécutions sont écrites (par défaut : `runs`, résolu par rapport au fichier de configuration) |

Une configuration fonctionnelle : `claude-rpg/dogfood/playtest/claude-rpg.playtest.json` (l’exécuteur Claude fourni est exécuté via le point de terminaison compatible Anthropic d’OpenRouter — `ANTHROPIC_BASE_URL=https://openrouter.ai/api`, l’application SDK ajoute `/v1/messages` — avec le remplacement `CLAUDE_RPG_MODEL` du jeu, qui donne un identifiant `anthropic/...`).

### Une note sur `game.inheritEnv`

Le processus du jeu reçoit une petite liste d’autorisation ainsi que votre `game.env`, et **pas** `OPENROUTER_API_KEY`. Ce n’était pas toujours le cas : la clé atteignait auparavant le jeu et était affichée sous forme de texte à l’écran, d’où elle passait dans le contexte du joueur et dans le rapport écrit. Si vous avez des exécutions antérieures à cette correction, considérez que la clé utilisée pour celles-ci est exposée. `inheritEnv: true` restaure l’héritage complet — utilisez-le uniquement pour un jeu auquel vous faites autant confiance qu’à l’exécuteur lui-même.

Voir [SECURITY.md](SECURITY.md) pour la description complète.

## Modèle de confiance

**Données concernées :** le fichier JSON du test, tout ce que `game.command` / le pont RPC affiche, les complétions de chat OpenRouter (joueur + jury) et les fichiers que l’exécuteur écrit dans `runsDir` (`transcript.txt`, `critique.json`, `meta.json`, `REPORT.md`, `REPORT.json`).

**Données non concernées :** l’exécuteur n’envoie aucune télémétrie et ne collecte aucune donnée analytique. Le processus du jeu ne reçoit pas `OPENROUTER_API_KEY`, sauf si vous définissez `game.inheritEnv: true`. Rien n’est écrit en dehors de `runsDir`.

**Autorisations :** `game.command` est `child_process.spawn` — une configuration de test est équivalente à un fichier exécutable. Examinez-la comme vous le feriez pour un script shell. La communication HTTPS sortante est uniquement l’URL de base OpenRouter configurée. Il n’y a pas de bac à sable.

## Télémétrie

Aucune. Aucune donnée analytique, aucun rapport d’erreur, aucune communication vers le domicile. La seule communication réseau est celle que vous avez configurée pour les modèles.

## Conformité aux normes (normes de flux de travail, score de 0 à 3)

- **PIN_PER_STEP — 2.** Chaque place fixe son identifiant de modèle ; les invites du joueur et du critique sont des constantes de code ; la configuration est l’entrée reproductible. OpenRouter ne fixe pas le routage du fournisseur, de sorte qu’une reproduction est identique en termes d’invite, et non en termes d’octets. *Solution : enregistrer le fournisseur choisi par appel dans `meta.json`.*
- **ANDON_AUTHORITY — 2.** Une place qui se bloque (`screenTimeoutMs`), se termine prématurément ou épuise les tentatives se termine avec une raison enregistrée ; une exécution où aucune place n’a produit de verdict se termine avec 4 au lieu de 0, de sorte qu’un échec de critique silencieux ne peut pas être interprété comme étant correct.
- **NAMED_COMPENSATORS — ignoré :** le seul artefact de l’exécuteur est le répertoire d’exécution ; sa suppression est l’annulation complète. Les effets secondaires du *jeu* lui appartiennent et sont indépendants du contrôle de l’exécuteur — ce qui explique pourquoi une configuration de test est traitée comme étant équivalente à un fichier exécutable.
- **DECOMPOSE_BY_SECRETS — 3.** `driver.ts` est la limite d’observation, `openrouter.ts` la seule limite de réseau, `panel.ts` la limite de jugement ; chacun a ses propres tests et une version fictive de l’autre côté.
- **UNCERTAINTY_GATED_HUMANS — 3.** Le rapport agrège mais ne tranche jamais, et il indique sa propre incertitude : les verdicts partagés, la couverture limitée, un avertissement d’échantillon unique et les critères auxquels aucun juge n’a répondu sont tous présentés plutôt que lissés.
- **EXTERNAL_VERIFIER — 3.** Chaque transcription est jugée par une famille qui ne l’a pas produite (par défaut : une place « auteur désactivé » ; augmenter `panelSize` pour signaler un désaccord), le désaccord étant signalé. **Ce score était de 3 alors que le code faisait le contraire** jusqu’à l’essaim du 14 septembre 2026 — le critique était le même modèle que celui qui jouait. L’affirmation correspond désormais à l’implémentation, et `pickJurors` renvoie un jury vide au lieu de revenir toujours à l’auteur.

## Développement

```bash
npm install
npm run verify      # typecheck (src AND tests) + vitest
npm run coverage    # vitest --coverage
```

182 tests. `tsconfig.test.json` existe parce que la configuration de la compilation exclut les fichiers de test, ce qui signifiait qu’aucun fichier de test n’était vérifié par un quelconque moyen — il a détecté de véritables erreurs de type lors de sa première exécution.

---

Créé par [MCP Tool Shop](https://mcp-tool-shop.github.io/).
