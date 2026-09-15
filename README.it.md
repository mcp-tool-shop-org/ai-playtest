<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.md">English</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/ai-playtest/readme.png" alt="ai-playtest" width="400">
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/ai-playtest/actions/workflows/ci.yml"><img src="https://github.com/mcp-tool-shop-org/ai-playtest/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://mcp-tool-shop-org.github.io/ai-playtest/"><img src="https://img.shields.io/badge/Landing_Page-live-brightgreen" alt="Landing Page"></a>
</p>

# test di intelligenza artificiale

Test di intelligenza artificiale con una varietà di famiglie per giochi a turni. I giocatori modello guidano un gioco —
tramite un terminale, uno pseudo-terminale o una connessione socket al tuo motore — una giuria di
modelli provenienti da *altre* famiglie valuta ogni trascrizione e un rapporto riassume i
verdicti, indicando anche quanto del gioco è stato effettivamente giocato in ogni sessione.

Una singola partita giocata da una persona ti dice cosa ha visto quella persona. Cinque famiglie
che giocano le stesse quaranta mosse ti dicono cosa succede nel mondo.

**Privato fino a quando non sarà opportuno.** Non disponibile su npm; utilizzato tramite percorso da repository correlati.

## Chi giudica

La prima cosa da sapere, perché è ciò che la maggior parte di questi strumenti sbaglia: **un
giocatore non può valutare la propria partita.** Ogni trascrizione viene valutata da un giudice esterno (`panelSize`, aumentalo per indicare disaccordo, non per calcolare un punteggio più alto), e la valutazione del giocatore viene conservata come *testimonianza*:
dove si è confuso, cosa ha provato, ma non come punteggio.

Questa distinzione è fondamentale. La maggior parte delle preferenze misurate nei giudici LLM
si rivela essere competenza piuttosto che narcisismo (solo circa il 10,4% supera un controllo abbinato per capacità su 37.448 coppie — [Roytburg et al.
2026](https://arxiv.org/html/2601.22548)), **ma il residuo si concentra in
domini soggettivi e scompare in quelli verificabili** — e "il mondo sembrava vivo" è un criterio tanto soggettivo quanto possibile. Nel frattempo, l'autocritica riduce attivamente la precisione, mentre un verificatore esterno la aumenta: Game-of-24 passa dal 5% al 3% con autocritica e al 38% con un verificatore valido ([Stechly et al.
2024](https://arxiv.org/abs/2402.08115)).

L'impostazione predefinita è **un giudice esterno**, non una giuria di tre giudici. [Verga et al.
2024](https://arxiv.org/abs/2404.18796) (PoLL) ha dimostrato che una giuria eterogenea a basso costo supera GPT-4 in termini di accordo umano a un costo inferiore di 7-8 volte (κ 0,763 rispetto a 0,627) —
questo è un argomento contro il pagamento per un giudice *grande*, non un argomento che tre famiglie producono tre voti indipendenti. [Kohli
2026](https://arxiv.org/abs/2605.29800) ha misurato nove giudici in sette
famiglie su Kish **n_eff = 2,18**; la giuria (72,0%) *non* ha superato il singolo giudice migliore (71,8%); la correlazione tra famiglie è stata di 0,389 rispetto a 0,437 tra membri della stessa famiglia. Con
`panelSize: 3`, questo equivale a **≈1,68 voti indipendenti**. Il metodo Dawid-Skene non risolve il problema (≤11% del divario di Condorcet). [Kim et al. 2025](https://arxiv.org/abs/2506.07962)
ha scoperto che le coppie sono d'accordo circa il 60% delle volte quando entrambe sbagliano. Quindi, i giudici aggiuntivi indicano un disaccordo, non un punteggio più alto. **Il budget è stato spostato dai giudici alle esecuzioni.**
`--runs 3` è descrittivo, non un test di significatività; la CLI rimane impostata su
una singola esecuzione, quindi un test di base rimane una singola esecuzione. n=3 non può mai raggiungere p<0,05 (limite inferiore `2/2^n` = 0,25). Vedi `docs/research-2.md` §A e `docs/research-3.md`.

Questo **non** annulla l'esclusione del giocatore dalla propria giuria, che si basa su
Panickssery / Stechly / Huang.

**Il disaccordo viene segnalato, non mediato.** Un verdetto contrastante di solito significa
che il *criterio* non è sufficientemente definito, non che il gioco è ambiguo, quindi i contrasti sono
contrassegnati con il loro conteggio e viene visualizzata la dispersione di ogni giocatore.

Se c'è solo una famiglia, non c'è un giudice valido. Lo strumento non restituisce semplicemente
la trascrizione al suo autore; non forma una giuria e il rapporto indica che il verdetto è auto-valutato e perché è debole. La convalida della configurazione rifiuta comunque di
assegnare due giocatori della stessa famiglia: una seconda famiglia è ciò che rende possibile una giuria esterna ([Panickssery et al. 2024](https://arxiv.org/abs/2404.13076)).

## Driver: come viene osservato il gioco

| driver | channel | for |
|---|---|---|
| `stdio` | lines | giochi di testo orientati alle righe (impostazione predefinita) |
| `pty` | una griglia terminale renderizzata | interfacce utente a schermo intero (ratatui, ncurses) |
| `rpc` | stato strutturato su TCP | Godot, Unreal, qualsiasi cosa tu possa monitorare |

L'ordine si basa su quanto è *strutturato* il canale, ed è una scelta deliberata piuttosto
che una questione di gusto. Le osservazioni dell'albero di accessibilità raddoppiano approssimativamente
il successo delle osservazioni basate solo su screenshot su [OSWorld](https://arxiv.org/abs/2404.07972) (12,24% rispetto al 5,26%); su [BALROG](https://arxiv.org/abs/2411.13543) *l'aggiunta* della visione ha peggiorato diversi modelli (GPT-4o 32,34% → 22,56%); il gioco basato su pixel non strutturati si attesta vicino allo zero su [VideoGameBench](https://arxiv.org/abs/2505.18134) (0,48% di completamento del gioco); e [Voyager](https://arxiv.org/abs/2305.16291), ancora l'agente di gioco open-ended più potente, ha utilizzato un'API strutturata e non ha mai visto un pixel.

Quindi, uno screenshot è un *allegato* opzionale a un'osservazione, non l'unico canale. **Se il tuo gioco può descriversi, dovrebbe farlo** — vedi
[docs/engine-bridge.md](docs/engine-bridge.md) per un modulo Godot 4 che puoi copiare e incollare, dove `_observation()` e `_apply()` sono le uniche funzioni che devi scrivere,
più il routing di Unreal.

### Perché `pty` è importante anche per i giochi di testo

In una pipe, l'output stdout di un programma C viene completamente memorizzato nel buffer, quindi "l'output è diventato silenzioso per N ms" può significare *"non è ancora stato scaricato"* piuttosto che *"sta aspettando che tu faccia qualcosa"*. Un PTY ripristina il buffering di riga e rende la regola di prontezza affidabile. Su Windows, una pipe non cattura nulla da un gioco che disegna tramite l'API Console.

Questo risolve anche come appare un ridisegno. Misurato sull'interfaccia utente di test: la griglia contiene
**115 caratteri di una schermata corrente**, mentre la visualizzazione di aggiunta di righe contiene **416
caratteri** di tre ridisegni impilati con l'input del giocatore intercalato e *tre valori di HP contraddittori*. Il modello deve indovinare quale è quello attivo.

`pty` richiede `node-pty` e `@xterm/headless` opzionali. Questi vengono installati precompilati
su Windows e macOS; node-pty viene compilato su Linux. Senza di essi, il driver fallisce
con un errore codificato che indica il comando di installazione; nient'altro è interessato.

## Quanto ha effettivamente visto ogni giocatore

Un modello di giocatore che non esplora produce un rapporto sicuro su un gioco a cui
ha a malapena dato un'occhiata. Ogni esecuzione include quindi un blocco di copertura calcolato esclusivamente dai
dati delle partite — nessuna strumentazione, nessuna chiamata aggiuntiva al modello: la curva di novità
e l'emivita, i tassi di ripetizione/ciclo/auto-ciclo, l'entropia delle azioni e una semplice
`thin` / `moderate` / `broad` lettura con le relative motivazioni.

Questo è utile perché il fallimento viene misurato, non è solo teorico.
Gli agenti LLM orientati al compito ripetono la loro azione precedente nel **63,4%** dei casi, con un
tasso di ciclo del 16,0%, rispetto al 24,9% / 7,7% degli agenti *addestrati* all'esplorazione ([Ye
et al. 2026](https://arxiv.org/html/2605.16143)). Consideralo come l'intervallo in cui si colloca effettivamente la ripetizione dell'agente, e non come qualcosa che una stringa di personalità può "acquistare", poiché
semplicemente chiedere a un agente di esplorare vale solo **+2,57** in termini di tasso di successo medio (@1)
([Englander et al. 2026](https://arxiv.org/html/2604.17609)). Una bassa entropia delle azioni indica anche un *basso* successo piuttosto che efficienza, quindi una trascrizione ordinata con pochi
input distinti è un segnale di avvertimento, non un buon segno.

## Come interpretare un verdetto

**I punteggi relativi sono importanti; non fidarsi dei punteggi assoluti.** Questa è la più importante avvertenza
presente nello strumento e deriva da due fonti indipendenti. I giudici LLM della qualità narrativa raggiungono un livello τ ≈ 0,70, rispetto a un limite umano di 0,73,
ma a livello di storia il valore di τ è solo 0,16–0,25, a malapena superiore a BERTScore ([Chhun et al.
2024](https://arxiv.org/abs/2405.13769)). Il playtesting automatizzato convalida lo stesso concetto: i tassi di successo dell'IA corrispondono ai tassi di successo umani con ρ = 0,80 su 95.266 giocatori
([Roohi et al. 2021](https://arxiv.org/abs/2107.12061)), mentre le capacità assolute dell'agente non si trasferiscono affatto.

Quindi, "la build B ha ottenuto un punteggio inferiore rispetto alla build A in *reagisce-al-giocatore*" è un'affermazione che questo strumento supporta. "Questo gioco è vivo: sì" non lo è, e il rapporto è scritto per mantenere
questa distinzione ben visibile.

**Un divario noto, espresso in modo chiaro:** non abbiamo trovato studi che misurino l'accordo
tra i problemi rilevati dai tester automatizzati e i problemi rilevati dai tester umani
*per quanto riguarda la qualità dell'esperienza*. Il playtesting automatizzato è convalidato solo in base alla difficoltà
e alla competenza. La premessa centrale dello strumento — che le confusioni di un modello
assomiglino a quelle di un giocatore — non è quindi stata testata nella letteratura, in nessun caso. Considera
i punti deboli e le confusioni come indizi da verificare, non come risultati definitivi.

## Come funziona

1. **Osserva.** Il driver produce un `Observation`: sempre `text`, facoltativamente un
terminale `grid`, una struttura `state`, un allegato `image` e i `actions`
che sono validi in questo momento. Registra anche *come* ha capito che era il turno del giocatore: un segnale emesso dal gioco, un segnale di prontezza del terminale, un modello di prompt o
un'ipotesi di inattività, in modo da poter distinguere la conoscenza dall'inferenza.
2. **Configurazione predefinita.** I prompt che corrispondono a una regex `setup[].match` vengono elaborati
dalla configurazione, senza il giocatore e senza consumare un turno, in modo che ogni famiglia
inizi con lo stesso personaggio.
3. **Il giocatore** vede lo schermo dall'ultimo input, più gli ultimi
scambi `playerMemoryTurns`, con una sintesi fornita da `persona` (obiettivi e registro —
mai le meccaniche in fase di test) e risponde con una sola riga. Le risposte non valide
ritornano a `look`.
4. **Agisci.** Quando l'osservazione contiene `actions`, la risposta pulita viene mappata su
`choose` / `key` / `line`. Un errore in un insieme chiuso è un evento del framework: il runner
non consuma un turno di gioco per questo. La configurazione e l'uscita rimangono `kind:line`.
5. **Esci.** Dopo `turns` input, il runner invia `quitInputs` (ad esempio, `save`,
`quit`). Questi sono gli input del *runner*: vengono esclusi dal conteggio dei turni e dalle prove, mentre gli schermi terminali che producono vengono conservati: un crash o un riepilogo del salvataggio sono prove.
6. **La giuria** — un membro esterno per impostazione predefinita, con temperatura 0 — valuta
la trascrizione rispetto a `criteria[]`. I giurati aggiuntivi (se `panelSize` > 1) segnalano
il disaccordo; non vengono mediati in un punteggio più alto. La valutazione del giocatore
è una testimonianza.
7. **Controlli deterministici** vengono eseguiti sui dati dei turni: SCC assorbente (Tarjan, mai etichettato come trappola), attribuzione di input ignorati, regex facoltative per parser/vittoria/morte, finestre di assenza di progressi, indizi sull'apparizione di entità e (quando `state` è
un oggetto) invarianti di HP/inventario.
8. **Il rapporto** aggrega: criteri per famiglia con suddivisioni dei giurati, copertura come qualificatore di campionamento, il blocco di verifica e ogni punto debole e confusione elencati: prima i risultati della giuria, poi la testimonianza dell'autore. I glifi
(`!`, `H(a)`, `repeat`, `loop`) sono spiegati nella legenda sulla pagina.

Artefatti per ogni sessione sotto `<runsDir>/<label>/<seat>/`: `transcript.txt`,
`critique.json`, `meta.json` (pin `schemaVersion` + `toolVersion`),
`stderr.txt` (se il gioco ha scritto qualcosa). `REPORT.md` e `REPORT.json`
(`kind: "single-run-report"`) nella directory principale.

## Utilizzo

```bash
export OPENROUTER_API_KEY=...
npm run build
node dist/cli.js run path/to/game.playtest.json --label phase9
node dist/cli.js run path/to/game.playtest.json --label smoke --seats mistral --turns 8
node dist/cli.js run path/to/game.playtest.json --label compare --runs 3   # descriptive; cannot reach p<0.05
node dist/cli.js run path/to/game.playtest.json --label rpc --serial       # one game, several seats; needed for RPC until you multiplex
node dist/cli.js report path/to/game.playtest.json --label phase9   # rebuild REPORT.md + REPORT.json from disk
```

`--serial` esegue le sessioni una dopo l'altra. Sul driver RPC, riutilizza un singolo client TCP e chiama `reset()` tra le sessioni. Senza `--serial`, ogni sessione RPC
è un processo separato: si verificheranno conflitti se condividono lo stesso gioco in ascolto.

Codici di uscita: 0 ok · 1 utilizzo · 2 configurazione · 3 provider (chiave mancante, il modello non ha endpoint) · 4 errore di esecuzione (ogni sessione è terminata con un errore, o nessuna sessione ha prodotto un verdetto). Gli errori stampano `error:` e `hint:`.

## Riferimento alla configurazione

| chiave | significato |
|---|---|
| `name` | nome del test (titolo del rapporto) |
| `driver` | `{"kind":"stdio"}` (predefinito), `{"kind":"pty","cols":100,"rows":30,"readySentinel":"..."}` o `{"kind":"rpc","port":7777,"host":"127.0.0.1"}` |
| `game.command`, `game.args`, `game.cwd` | come avviare il gioco; `cwd` si risolve rispetto al file di configurazione. Non necessario per il driver `rpc`, che si connette a un gioco in esecuzione |
| `game.env` | variabili d'ambiente aggiuntive per il gioco; un valore `$NAME` legge le variabili d'ambiente del runner |
| `game.inheritEnv` | passa l'intero ambiente del runner al gioco. **Disattivato per impostazione predefinita** — vedi sotto |
| `game.promptPatterns` | regex che significano "in attesa di una riga", testate rispetto alla coda eliminata (`stdio`) o alla riga del cursore renderizzata (`pty`) |
| `game.promptQuietMs` / `idleQuietMs` / `screenTimeoutMs` | la regola di attesa (predefinito 800 / 6000 / 180000 ms) |
| `game.quitInputs` | righe inviate dopo l'ultimo turno (predefinito `["quit"]`) |
| `seats[]` | `{ id, family, model }` — identificatori OpenRouter; un posto per famiglia |
| `panelSize` | giudici "author-off" per trascrizione (valore predefinito **1**; aumentarlo per segnalare disaccordo, non per ottenere un punteggio medio più alto) |
| `verifiers` | liste di espressioni regolari opzionali (`unparsed`, `refused`, `victory`, `death`; vuote = non indovinare). Occupazione: `absorbingMinTurns` (valore predefinito 4), `noProgressWindow` (valore predefinito 5), `noOpVerbs` |
| `setup[]` | `{ match, answer }` risposte predefinite per le richieste di configurazione |
| `turns` | input di gioco per posto (le risposte di configurazione e gli input di uscita non vengono conteggiati; valore predefinito 40) |
| `persona` | la descrizione del gioco |
| `criteria[]` | `{ id, check }` i criteri di "sopravvivenza" del gioco |
| `screenChars` | numero di caratteri dello schermo mantenuti per turno (valore predefinito 6000) |
| `playerMemoryTurns` | turni recenti visualizzati dal giocatore (valore predefinito 8) |
| `playerTemperature` | temperatura di campionamento del giocatore (valore predefinito 0,7); il critico è sempre 0 |
| `runsDir` | dove vengono scritte le esecuzioni (valore predefinito `runs`, risolto rispetto al file di configurazione) |

Una configurazione funzionante: `claude-rpg/dogfood/playtest/claude-rpg.playtest.json` (l'esecuzione del narratore Claude fornito utilizza l'endpoint compatibile con Anthropic di OpenRouter — `ANTHROPIC_BASE_URL=https://openrouter.ai/api`, l'SDK aggiunge `/v1/messages` — con l'override `CLAUDE_RPG_MODEL` del gioco che assegna un identificatore `anthropic/...`).

### Una nota su `game.inheritEnv`

Il processo di gioco ottiene una piccola lista di elementi consentiti più il tuo `game.env`, e **non** `OPENROUTER_API_KEY`. Questo non è sempre stato vero: in precedenza, la chiave raggiungeva il gioco ed è stato osservato che veniva visualizzata come testo sullo schermo, da dove passava al contesto del giocatore e al rapporto scritto. Se hai esecuzioni precedenti a questa correzione, considera la chiave utilizzata per esse come esposta. `inheritEnv: true` ripristina l'ereditarietà completa: usalo solo per un gioco di cui ti fidi tanto quanto l'esecutore stesso.

Consulta [SECURITY.md](SECURITY.md) per la descrizione completa.

## Modello di fiducia

**Dati interessati:** il file JSON del test di gioco, qualsiasi cosa `game.command` / il bridge RPC stampi, i risultati delle chat di OpenRouter (giocatore + giuria) e i file che l'esecutore scrive in `runsDir` (`transcript.txt`, `critique.json`, `meta.json`, `REPORT.md`, `REPORT.json`).

**Dati non interessati:** l'esecutore non invia dati di telemetria né raccoglie dati analitici. Il processo di gioco non riceve `OPENROUTER_API_KEY` a meno che tu non imposti `game.inheritEnv: true`. Nulla viene scritto al di fuori di `runsDir`.

**Autorizzazioni:** `game.command` è `child_process.spawn`: una configurazione del test di gioco è equivalente a un file eseguibile. Esaminala come faresti con uno script della shell. L'HTTPS in uscita è solo l'URL di base configurato di OpenRouter. Non esiste una sandbox.

## Telemetria

Nessuna. Nessun dato analitico, nessun sistema di segnalazione degli errori, nessun "chiamata a casa". L'unica chiamata di rete è quella che hai configurato per i modelli.

## Conformità agli standard (standard del flusso di lavoro, punteggio da 0 a 3)

- **PIN_PER_STEP — 2.** Ogni posto assegna il proprio identificatore di modello; le richieste del giocatore e del critico sono costanti nel codice; la configurazione è l'input riproducibile. OpenRouter non assegna il routing del provider, quindi una riproduzione è identica in termini di richiesta, non di byte.
*Correzione: registra il provider scelto per ogni chiamata in `meta.json`.*
- **ANDON_AUTHORITY — 2.** Un posto che si blocca (`screenTimeoutMs`), esce prematuramente o esaurisce i tentativi termina con un motivo registrato; un'esecuzione in cui nessun posto ha prodotto un verdetto termina con 4 anziché con 0, quindi un errore di valutazione silenzioso non può essere interpretato come corretto.
- **NAMED_COMPENSATORS — ignora:** l'unico artefatto dell'esecutore è la directory di esecuzione; eliminarla è l'unica operazione di annullamento. Gli effetti collaterali del *gioco* sono di sua competenza e al di fuori del controllo dell'esecutore, ed è esattamente per questo che una configurazione del test di gioco viene trattata come equivalente a un file eseguibile.
- **DECOMPOSE_BY_SECRETS — 3.** `driver.ts` è il punto di osservazione, `openrouter.ts` l'unico punto di rete, `panel.ts` il punto di valutazione; ognuno ha i propri test e un elemento fittizio sull'altro lato.
- **UNCERTAINTY_GATED_HUMANS — 3.** Il rapporto aggrega ma non decide mai e dichiara la propria incertezza: verdetti contrastanti, copertura limitata, un avviso di campione singolo e criteri a cui nessun giudice ha risposto vengono tutti presentati anziché attenuati.
- **EXTERNAL_VERIFIER — 3.** Ogni trascrizione viene valutata da una famiglia che non l'ha prodotta (per impostazione predefinita, un posto "author-off"; aumenta `panelSize` per segnalare disaccordo), con il disaccordo segnalato. **Questo ha ottenuto un punteggio di 3 mentre il codice faceva il contrario** fino allo sciame del 2026-09-14: il critico era lo stesso modello che ha giocato. L'affermazione ora corrisponde all'implementazione e `pickJurors` restituisce una giuria vuota anziché ricorrere al creatore.

## Sviluppo

```bash
npm install
npm run verify      # typecheck (src AND tests) + vitest
npm run coverage    # vitest --coverage
```

182 test. `tsconfig.test.json` esiste perché la configurazione della build esclude i file di test, il che significava che nessun file di test veniva controllato dal punto di vista del tipo da alcun sistema: ha rilevato errori di tipo reali durante la sua prima esecuzione.

---

Creato da [MCP Tool Shop](https://mcp-tool-shop.github.io/).
