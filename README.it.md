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

# ai-playtest

Test di gioco con IA diversificata per giochi a turni. I modelli di giocatori gestiscono un gioco —
tramite un terminale, un pseudo-terminale o una connessione socket al motore — una giuria di
modelli provenienti da *altre* famiglie valuta ogni trascrizione e un rapporto riassume i
verdicti, indicando anche quanto del gioco è stato effettivamente giocato in ogni sessione.

Una singola partita giocata da una persona ti dice cosa ha visto quella persona. Cinque famiglie
che giocano le stesse quaranta mosse ti dicono come reagisce il mondo.

Versione 1.0.0. Disponibile su GitHub. Non ancora su npm: clonalo o utilizzalo tramite percorso da un repository correlato.

## Chi valuta

La prima cosa da sapere, perché è ciò che la maggior parte di questi strumenti sbaglia: **un
giocatore non può valutare la propria partita.** Ogni trascrizione viene valutata da un giudice esterno (di default `panelSize`, aumentalo per indicare disaccordo, non per ottenere un punteggio più alto), e la valutazione del giocatore viene conservata come *testimonianza*:
dove si è confuso, cosa ha provato, ma non come punteggio.

Questa distinzione è fondamentale. La maggior parte delle misurazioni della preferenza di sé nei modelli linguistici
si rivela essere competenza piuttosto che narcisismo (solo circa il 10,4% supera un controllo abbinato in base alle capacità su 37.448 coppie — [Roytburg et al.
2026](https://arxiv.org/html/2601.22548)), **ma il residuo si concentra
in ambiti soggettivi e scompare in quelli verificabili** — e "il mondo sembrava vivo" è un criterio tanto soggettivo quanto possibile. Nel frattempo, l'autocritica riduce attivamente la precisione, mentre un verificatore esterno la aumenta: Game-of-24 passa dal 5% al 3% con l'autocritica e al 38% con un verificatore valido ([Stechly et al.
2024](https://arxiv.org/abs/2402.08115)).

Il valore predefinito è **un solo giudice esterno**, non una giuria di tre giudici. [Verga et al.
2024](https://arxiv.org/abs/2404.18796) (PoLL) ha dimostrato che una giuria eterogenea a basso costo supera GPT-4 in termini di accordo umano con un costo inferiore di 7-8 volte (κ 0,763 rispetto a 0,627) —
questo è un argomento contro il pagamento per un giudice *molto grande*, non un argomento che tre famiglie producono tre voti indipendenti. [Kohli
2026](https://arxiv.org/abs/2605.29800) ha misurato nove giudici provenienti da sette
famiglie su Kish **n_eff = 2,18**; la giuria (72,0%) *non* ha superato il singolo giudice migliore (71,8%); la correlazione tra famiglie è stata di 0,389 rispetto a 0,437 all'interno della stessa famiglia. Su `panelSize: 3`, questo equivale a **≈1,68 voti indipendenti**. Il metodo Dawid-Skene non risolve il problema (≤11% del divario di Condorcet). [Kim et al. 2025](https://arxiv.org/abs/2506.07962)
ha scoperto che le coppie sono d'accordo circa il 60% delle volte quando entrambe sbagliano. Quindi, i giudici aggiuntivi indicano un disaccordo, non un punteggio più alto. **Il budget è stato spostato dai giudici alle esecuzioni.**
`--runs 3` è descrittivo, non un test di significatività; la CLI continua a utilizzare un'unica esecuzione come impostazione predefinita, in modo che un test preliminare sia una singola esecuzione. n=3 non può mai raggiungere p<0,05 (limite `2/2^n` = 0,25). Vedi `docs/research-2.md` §A e `docs/research-3.md`.

Questo **non** annulla l'esclusione del giocatore dalla propria giuria, che si basa su
Panickssery / Stechly / Huang.

**Il disaccordo viene segnalato, non mediato.** Un verdetto contrastante di solito significa che il *criterio* non è sufficientemente definito, non che il gioco sia ambiguo, quindi i contrasti vengono contrassegnati con il loro conteggio e viene visualizzata la dispersione di ogni giocatore.

Se c'è solo una famiglia, non c'è un giudice valido. Lo strumento non restituisce semplicemente la trascrizione al suo autore: non forma una giuria e il rapporto indica che il verdetto è auto-valutato e spiega perché è debole. La convalida della configurazione continua a rifiutare l'assegnazione di due giocatori provenienti dalla stessa famiglia: una seconda famiglia è ciò che rende possibile una giuria esterna ([Panickssery et al. 2024](https://arxiv.org/abs/2404.13076)).

## Driver: come viene osservato il gioco

| driver | channel | for |
|---|---|---|
| `stdio` | lines | giochi di testo orientati alle righe (impostazione predefinita) |
| `pty` | una griglia terminale renderizzata | interfacce utente a schermo intero (ratatui, ncurses) |
| `rpc` | stato strutturato tramite TCP | Godot, Unreal, qualsiasi cosa tu possa monitorare |

L'ordine si basa su quanto è *strutturato* il canale, ed è una scelta deliberata piuttosto che una questione di gusto. Le osservazioni dell'albero di accessibilità raddoppiano approssimativamente il successo ottenuto con le sole schermate su [OSWorld](https://arxiv.org/abs/2404.07972) (12,24% rispetto al 5,26%); su [BALROG](https://arxiv.org/abs/2411.13543), l'aggiunta della visione ha peggiorato diversi modelli (GPT-4o 32,34% → 22,56%); il gioco basato su pixel non strutturati si attesta vicino allo zero su [VideoGameBench](https://arxiv.org/abs/2505.18134) (0,48% di completamento del gioco); e [Voyager](https://arxiv.org/abs/2305.16291), ancora il più potente agente di gioco open-ended, ha utilizzato un'API strutturata e non ha mai visualizzato un pixel.

Quindi, una schermata è un *allegato* opzionale a un'osservazione, non l'unico canale. **Se il tuo gioco può descriversi, dovrebbe farlo** — vedi
[docs/engine-bridge.md](docs/engine-bridge.md) per un codice Godot 4 pronto all'uso, dove `_observation()` e `_apply()` sono le uniche funzioni che devi scrivere,
più il routing di Unreal.

### Perché `pty` è importante anche per i giochi di testo

In una pipe, l'output stdout di un programma C viene completamente memorizzato nel buffer, quindi "l'output è diventato silenzioso per N ms" può significare *"non è ancora stato scaricato"* piuttosto che *"sta aspettando che tu faccia qualcosa"*. Un PTY ripristina il buffering di riga e rende la regola di prontezza più affidabile. Su Windows, una pipe non cattura nulla da un gioco che disegna tramite l'API Console.

Risolve anche come appare un ridisegno. Misurato sull'interfaccia utente di test: la griglia contiene **115 caratteri di uno schermo corrente**, mentre la visualizzazione di aggiunta di righe contiene **416 caratteri** di tre ridisegni impilati con l'input ripetuto del giocatore e *tre valori di HP contraddittori*. Il modello deve indovinare quale sia quello corretto.

`pty` richiede le opzioni `node-pty` e `@xterm/headless`. Queste vengono installate automaticamente su Windows e macOS; node-pty viene compilato su Linux. Senza di esse, il driver fallisce con un errore codificato che indica il comando di installazione: nient'altro viene interessato.

## Quanto ha effettivamente visto ogni giocatore

Un modello giocatore che non esplora produce un rapporto sicuro su un gioco a cui ha a malapena dato un'occhiata. Pertanto, ogni esecuzione include un blocco di copertura calcolato solo dai record delle mosse: nessun monitoraggio, nessuna chiamata di modello aggiuntiva: la curva di novità e l'emivita, i tassi di ripetizione/ciclo/auto-ciclo, l'entropia delle azioni e una semplice lettura di `thin` / `moderate` / `broad` con le relative motivazioni.

Questo strumento è utile perché il fallimento viene misurato, non è solo teorico.
Gli agenti LLM orientati al compito ripetono la loro azione precedente nel **63,4%** dei casi, con una frequenza di ripetizione del 16,0%, rispetto al 24,9% / 7,7% degli agenti *addestrati* all'esplorazione ([Ye et al. 2026](https://arxiv.org/html/2605.16143)). Considera questo dato come la frequenza effettiva con cui un agente ripete le azioni, e non come qualcosa che una stringa di personalità può "acquistare", poiché limitarsi a chiedere a un agente di esplorare vale solo **+2,57** in termini di successo medio (@1) ([Englander et al. 2026](https://arxiv.org/html/2604.17609)). Una bassa entropia delle azioni indica anche un *basso* tasso di successo piuttosto che di efficienza, quindi una trascrizione ordinata con pochi input distinti è un segnale di avvertimento, non un buon segno.

## Come interpretare un risultato

**I punteggi assoluti sono fuorvianti; affidarsi invece alle classifiche.** Questa è l'avvertenza più importante nello strumento e deriva da due fonti indipendenti. I giudici LLM che valutano la qualità narrativa raggiungono un livello di coerenza di τ ≈ 0,70, rispetto a un limite umano di 0,73, ma a livello di storia, la coerenza è solo di 0,16-0,25, a malapena superiore a BERTScore ([Chhun et al. 2024](https://arxiv.org/abs/2405.13769)). Il test automatizzato conferma lo stesso principio: i tassi di successo dell'IA corrispondono ai tassi di successo umani con ρ = 0,80 su 95.266 giocatori ([Roohi et al. 2021](https://arxiv.org/abs/2107.12061)), mentre le capacità assolute dell'agente non si trasferiscono affatto.

Quindi, "la build B ha ottenuto un punteggio inferiore rispetto alla build A nel test *reazione-al-giocatore*" è un'affermazione che questo strumento supporta. "Questo gioco è vivo: sì" non lo è, e il rapporto è strutturato per mantenere questa distinzione chiara.

**Un divario noto, espresso in modo chiaro:** nessun studio che abbiamo potuto trovare misura la coerenza tra i problemi rilevati dai tester automatici e i problemi rilevati dai tester umani *in termini di qualità dell'esperienza*. Il test automatizzato è convalidato solo in base alla difficoltà e alla competenza. La premessa centrale dello strumento, ovvero che le confusioni di un modello assomiglino a quelle di un giocatore, non è quindi stata testata in letteratura. Considerare i punti critici e le confusioni come indizi da verificare, non come risultati definitivi.

## Come funziona

1. **Osserva.** Il driver produce un `Observation`: sempre `text`, facoltativamente un `grid` finale, una struttura `state`, un allegato `image` e i `actions` che sono validi in questo momento. Registra anche *come* ha capito che era il turno del giocatore: un segnale emesso dal gioco, un segnale di prontezza finale, un modello di prompt o un'ipotesi di inattività, in modo da poter distinguere la conoscenza dall'inferenza.
2. **Configurazione predefinita.** I prompt che corrispondono a un'espressione regolare `setup[].match` vengono elaborati dalla configurazione, senza il giocatore e senza consumare un turno, in modo che ogni famiglia inizi con lo stesso personaggio.
3. **Il giocatore** vede lo schermo dall'ultimo input, insieme agli ultimi `playerMemoryTurns` scambi, e riceve informazioni da `persona` (obiettivi e registro, mai le meccaniche in fase di test), quindi risponde con una sola riga. Le risposte non valide vengono gestite con `look`.
4. **Agisce.** Quando l'osservazione contiene `actions`, la risposta pulita viene mappata su `choose` / `key` / `line`. Un errore in un insieme chiuso è un evento di test: il runner non consuma un turno di gioco per questo. La configurazione e l'uscita rimangono `kind:line`.
5. **Termina.** Dopo `turns` input, il runner invia `quitInputs` (ad esempio, `save`, `quit`). Questi sono gli input del *runner*: vengono esclusi dal conteggio dei turni e dalle prove, mentre gli schermi finali che producono vengono conservati: un crash o un riepilogo del salvataggio sono prove.
6. **La giuria** (un giudice esterno per impostazione predefinita, con temperatura 0) valuta la trascrizione in base a `criteria[]`. I giurati aggiuntivi (se `panelSize` > 1) segnalano la mancanza di accordo; non vengono utilizzati per calcolare un punteggio più elevato. La valutazione del giudice principale è una testimonianza.
7. **Controlli deterministici** vengono eseguiti sui registri dei turni: SCC assorbente (Tarjan, mai etichettata come trappola), attribuzione di input ignorati, espressioni regolari facoltative per parser/vittoria/morte, finestre di assenza di progressi, indizi sull'apparizione di entità e (quando `state` è un oggetto) invarianti di HP/inventario.
8. **Il rapporto** aggrega: criteri per famiglia con divisioni dei giurati indicate, copertura come qualificatore del campionamento, il blocco di verifica e ogni punto critico e confusione elencati: prima i risultati della giuria, poi la testimonianza dell'autore. I glifi (`!`, `H(a)`, `repeat`, `loop`) sono spiegati nella legenda a piè di pagina.

Artefatti per ogni giudice sotto `<runsDir>/<label>/<seat>/`: `transcript.txt`, `critique.json`, `meta.json` (pin `schemaVersion` + `toolVersion`), `stderr.txt` (se il gioco ha scritto qualcosa). `REPORT.md` e `REPORT.json` (`kind: "single-run-report"`) nella directory principale.

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

`--serial` esegue i test in sequenza. Sul driver RPC, riutilizza un singolo client TCP e chiama `reset()` tra i test. Senza `--serial`, ogni test RPC è un processo separato: si verificheranno conflitti se condividono lo stesso gioco in ascolto.

Codici di uscita: 0 ok · 1 utilizzo · 2 configurazione · 3 provider (chiave mancante, il modello non ha endpoint) · 4 errore di esecuzione (ogni test è terminato con un errore, oppure nessun test ha prodotto un risultato). Gli errori stampano `error:` e `hint:`.

## Riferimento alla configurazione

| chiave | significato |
|---|---|
| `name` | nome del test (titolo del rapporto) |
| `driver` | `{"kind":"stdio"}` (predefinito), `{"kind":"pty","cols":100,"rows":30,"readySentinel":"..."}` o `{"kind":"rpc","port":7777,"host":"127.0.0.1"}` |
| `game.command`, `game.args`, `game.cwd` | come avviare il gioco; `cwd` si risolve rispetto al file di configurazione. Per `rpc`, impostare `command` e `run` legge `PLAYTEST_BRIDGE_PORT=` dal processo (quella porta ha la precedenza su `driver.port`). Lasciare `command` vuoto per connettersi a un gioco già in ascolto. Due o più test con un comando richiedono `--serial` |
| `game.env` | variabili d'ambiente aggiuntive per il gioco; un valore `$NAME` legge le variabili d'ambiente del runner |
| `game.inheritEnv` | passa l'intero ambiente del runner al gioco. **Disattivato per impostazione predefinita** - vedere di seguito |
| `game.promptPatterns` | espressioni regolari che significano "in attesa di una riga", testate rispetto alla parte finale eliminata (`stdio`) o alla riga del cursore renderizzata (`pty`) |
| `game.promptQuietMs` / `idleQuietMs` / `screenTimeoutMs` | la regola di attesa (predefinito 800 / 6000 / 180000 ms) |
| `game.quitInputs` | righe inviate dopo l'ultimo turno (predefinito `["quit"]`) |
| `seats[]` | `{ id, family, model }` - OpenRouter test; un test per famiglia |
| `panelSize` | giudici esterni per trascrizione (predefinito **1**; aumentare per segnalare la mancanza di accordo, non per calcolare un punteggio più elevato) |
| `verifiers` | elenchi di espressioni regolari facoltative (`unparsed`, `refused`, `victory`, `death`; vuoto = non indovinare). Occupazione: `absorbingMinTurns` (predefinito 4), `noProgressWindow` (predefinito 5), `noOpVerbs` |
| `setup[]` | `{ match, answer }` risposte predefinite per i prompt di configurazione |
| `turns` | test di input per test (le risposte di configurazione e gli input di uscita non vengono conteggiati; predefinito 40) |
| `persona` | il briefing del giocatore |
| `criteria[]` | `{ id, check }`, i criteri di "sopravvivenza" del gioco |
| `screenChars` | numero di personaggi visualizzati per turno (valore predefinito: 6000) |
| `playerMemoryTurns` | numero di turni recenti visualizzati dal giocatore (valore predefinito: 8) |
| `playerTemperature` | temperatura di campionamento del giocatore (valore predefinito: 0,7); il valutatore è sempre 0 |
| `runsDir` | directory in cui vengono salvati i risultati (valore predefinito: `runs`, risolto in base al file di configurazione) |

Una configurazione funzionante: `claude-rpg/dogfood/playtest/claude-rpg.playtest.json` (il
narratore Claude fornito con il gioco esegue OpenRouter, un endpoint compatibile con Anthropic — `ANTHROPIC_BASE_URL=https://openrouter.ai/api`, l'SDK aggiunge
`/v1/messages` — con l'override `CLAUDE_RPG_MODEL` del gioco, assegnando un
identificatore `anthropic/...`).

### Una nota su `game.inheritEnv`

Il processo di gioco riceve una piccola lista di elementi consentiti più `game.env`, e **non**
`OPENROUTER_API_KEY`. In passato non era sempre così: la chiave raggiungeva il
gioco ed era visualizzata come testo sullo schermo, da dove passava al
contesto del giocatore e al rapporto scritto. Se si dispone di risultati precedenti a questa correzione,
considerare la chiave utilizzata per tali risultati come esposta. `inheritEnv: true` ripristina la piena
ereditarietà: utilizzarlo solo per un gioco di cui ci si fida tanto quanto il programma di esecuzione stesso.

Consultare [SECURITY.md](SECURITY.md) per la descrizione completa.

## Modello di fiducia

**Dati coinvolti:** il file JSON del test, qualsiasi cosa `game.command` / il bridge RPC stampi, OpenRouter completamenti di chat (giocatore + giuria) e i file che il
programma di esecuzione salva in `runsDir` (`transcript.txt`, `critique.json`,
`meta.json`, `REPORT.md`, `REPORT.json`).

**Dati non coinvolti:** il programma di esecuzione non invia dati di telemetria né raccoglie dati analitici. Il processo di gioco non riceve `OPENROUTER_API_KEY` a meno che
non si imposti `game.inheritEnv: true`. Nulla viene scritto al di fuori di `runsDir`.

**Autorizzazioni:** `game.command` è `child_process.spawn`: un file di configurazione del test è equivalente a un file eseguibile. Esaminarlo come si farebbe con uno script della shell.
L'unico accesso HTTPS in uscita è l'URL di base configurato OpenRouter. Non è presente alcuna sandbox.

## Telemetria

Nessuna. Nessun dato analitico, nessun sistema di segnalazione degli errori, nessun invio di dati a casa. L'unica chiamata di rete è quella configurata per i modelli.

## Conformità agli standard (standard del flusso di lavoro, punteggio da 0 a 3)

- **PIN_PER_STEP — 2.** Ogni "sede" associa il proprio identificatore di modello; i prompt del giocatore e del valutatore
sono costanti nel codice; il file di configurazione è l'input riproducibile. OpenRouter non associa
il routing del provider, quindi una riproduzione è identica nel prompt, non a livello di byte.
*Correzione: registrare il provider scelto per ogni chiamata in `meta.json`.*
- **ANDON_AUTHORITY — 2.** Una "sede" che si blocca (`screenTimeoutMs`), termina prematuramente o
esaurisce i tentativi, termina con un motivo registrato; un'esecuzione in cui nessuna "sede" ha prodotto un
verdetto termina con 4 anziché con 0, in modo che un errore di valutazione silenzioso non venga interpretato come corretto.
- **NAMED_COMPENSATORS — omesso:** l'unico artefatto del programma di esecuzione è la directory di esecuzione;
l'eliminazione di questa directory annulla completamente l'operazione. Gli effetti collaterali del *gioco* sono di sua competenza e
al di fuori del controllo del programma di esecuzione, il che è esattamente il motivo per cui un file di configurazione del test viene trattato come equivalente a un file eseguibile.
- **DECOMPOSE_BY_SECRETS — 3.** `driver.ts` è il punto di osservazione,
`openrouter.ts` l'unico punto di connessione di rete, `panel.ts` il punto di valutazione; ognuno ha
i propri test e un elemento fittizio dall'altra parte.
- **UNCERTAINTY_GATED_HUMANS — 3.** Il rapporto aggrega ma non decide mai, e indica la propria incertezza: verdetti contrastanti, copertura limitata, un avviso "campione di uno" e criteri a cui nessun valutatore ha risposto vengono tutti evidenziati anziché attenuati.
- **EXTERNAL_VERIFIER — 3.** Ogni trascrizione viene valutata da una famiglia che non l'ha
prodotta (per impostazione predefinita, una "sede" con un autore diverso; aumentare `panelSize` per segnalare
il disaccordo), e il disaccordo viene segnalato. **Questo ha ottenuto un punteggio di 3 mentre
il codice faceva il contrario** fino allo sciame del 2026-09-14: il valutatore era lo stesso
modello che aveva giocato. L'affermazione corrisponde ora all'implementazione e `pickJurors`
restituisce una giuria vuota anziché ricorrere all'autore.

## Sviluppo

```bash
npm install
npm run verify      # typecheck (src AND tests) + vitest
npm run coverage    # vitest --coverage
```

182 test. `tsconfig.test.json` esiste perché la configurazione di compilazione esclude i file di test, il che significava che nessun file di test veniva controllato per il tipo da alcun sistema: ha rilevato errori di tipo reali durante la sua prima esecuzione.

---

Creato da [MCP Tool Shop](https://mcp-tool-shop.github.io/).
