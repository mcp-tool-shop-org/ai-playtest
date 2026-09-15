<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.md">English</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/ai-playtest/readme.png" alt="ai-playtest" width="400">
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/ai-playtest/actions/workflows/ci.yml"><img src="https://github.com/mcp-tool-shop-org/ai-playtest/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://mcp-tool-shop-org.github.io/ai-playtest/"><img src="https://img.shields.io/badge/Landing_Page-live-brightgreen" alt="Landing Page"></a>
</p>

# pruebas de juego con IA

Pruebas de juego con IA que involucran a familias diversas para juegos por turnos. Los jugadores modelo impulsan un juego —
a través de una terminal, una pseudo-terminal o un socket conectado a tu motor — un jurado de
modelos de *otras* familias evalúa cada transcripción, y un informe recopila los
verdictos junto con la cantidad de juego que cada sesión realmente observó.

Una sola partida jugada por una persona te dice lo que una persona vio. Cinco familias
jugando las mismas cuarenta rondas te dicen cómo se comporta el mundo.

**Privado hasta que sea el momento adecuado.** No está en npm; se utiliza a través de la ruta desde repositorios hermanos.

## ¿Quién evalúa?

Lo primero que hay que saber, porque es lo que la mayoría de estas herramientas hacen mal: **un
jugador nunca evalúa su propia partida.** Cada transcripción es evaluada por un autor que no participa (`panelSize`, aumenta este valor para indicar desacuerdo, no para obtener una puntuación más alta), y la opinión del jugador se guarda como *testimonio*, donde se indica en qué se confundió y qué intentó, pero nunca como la puntuación.

Esta distinción es fundamental. La mayoría de las mediciones de la autopreferencia en los modelos de lenguaje grandes (LLM)
resultan ser una cuestión de competencia más que de narcisismo (solo alrededor del 10,4% supera un control con capacidades similares en 37.448 pares — [Roytburg et al.
2026](https://arxiv.org/html/2601.22548)), **pero el residuo se concentra en
dominios subjetivos y desaparece en aquellos que se pueden verificar** — y "el mundo se siente
vivo" es tan subjetivo como cualquier criterio. Mientras tanto, la autocrítica reduce activamente la precisión donde un verificador externo la aumenta: Game-of-24 pasa del 5% al 3% con autocrítica y al 38% con un verificador sólido ([Stechly et al.
2024](https://arxiv.org/abs/2402.08115)).

El valor predeterminado es **un solo evaluador**, no un panel de tres evaluadores. [Verga et al.
2024](https://arxiv.org/abs/2404.18796) (PoLL) demostró que un panel heterogéneo económico supera a GPT-4 en el acuerdo humano a un costo 7 a 8 veces menor (κ 0,763 frente a 0,627); esto es un argumento en contra de pagar por un solo evaluador *grande*, no un argumento de que tres familias den tres votos independientes. [Kohli
2026](https://arxiv.org/abs/2605.29800) midió nueve evaluadores de siete
familias en Kish **n_eff = 2,18**; el panel (72,0%) *no* superó al mejor
evaluador individual (71,8%); la correlación entre familias fue de 0,389 frente a 0,437 dentro de la misma familia. En
`panelSize: 3`, esto equivale a **≈1,68 votos independientes**. Dawid–Skene no lo soluciona
(≤11% de la diferencia de Condorcet). [Kim et al. 2025](https://arxiv.org/abs/2506.07962)
encontró que los pares están de acuerdo aproximadamente el 60% de las veces cuando ambos se equivocan. Por lo tanto, los jurados adicionales son una señal de desacuerdo, no una puntuación más alta. **El presupuesto se ha trasladado de los evaluadores a las partidas.**
`--runs 3` es descriptivo, no una prueba de significación; la CLI sigue utilizando
una partida por defecto para que una prueba rápida siga siendo una sola ejecución. n=3 nunca puede alcanzar p<0,05 (límite
`2/2^n` = 0,25). Consulte `docs/research-2.md` §A y `docs/research-3.md`.

Esto **no** anula la exclusión del autor de su propio jurado, lo cual se basa en
Panickssery / Stechly / Huang.

**El desacuerdo se informa, no se promedia.** Un veredicto dividido suele significar que el
*criterio* no está suficientemente especificado, no que el juego sea ambiguo, por lo que las divisiones se marcan con su recuento y se muestra la dispersión de cada jugador.

Si solo hay una familia, no hay un jurado válido. La herramienta no devuelve silenciosamente
la transcripción a su autor; no forma un jurado y el informe indica que el veredicto es una autoevaluación y por qué es débil. La validación de la configuración sigue rechazando la inclusión de dos jugadores de la misma familia: una segunda familia es lo que hace posible un jurado independiente ([Panickssery et al. 2024](https://arxiv.org/abs/2404.13076)).

## Controladores: cómo se observa el juego

| controlador | canal | para |
|---|---|---|
| `stdio` | líneas | juegos de texto orientados a líneas (el valor predeterminado) |
| `pty` | una **cuadrícula** de terminal renderizada | interfaces de usuario de texto (TUI) de pantalla completa (ratatui, ncurses) |
| `rpc` | estado estructurado a través de TCP | Godot, Unreal, cualquier cosa que puedas instrumentar |

El orden se basa en el grado de *estructuración* del canal, y esto es deliberado, no una cuestión de gusto. Las observaciones del árbol de accesibilidad duplican aproximadamente el éxito de las capturas de pantalla en [OSWorld](https://arxiv.org/abs/2404.07972) (12,24% frente a 5,26%); en [BALROG](https://arxiv.org/abs/2411.13543), *agregar* visión redujo directamente el rendimiento de varios modelos (GPT-4o 32,34% → 22,56%); el juego de píxeles sin estructurar se sitúa cerca de cero en [VideoGameBench](https://arxiv.org/abs/2505.18134) (0,48% de finalización del juego); y [Voyager](https://arxiv.org/abs/2305.16291), que sigue siendo el agente de juego de mundo abierto más potente, utilizó una API estructurada y nunca vio un píxel.

Por lo tanto, una captura de pantalla es un *archivo adjunto* opcional en una observación, nunca el único canal. **Si tu juego puede describirse a sí mismo, debería hacerlo**; consulte
[docs/engine-bridge.md](docs/engine-bridge.md) para obtener un código de Godot 4 que puedes copiar y pegar, donde `_observation()` y `_apply()` son las únicas funciones que tienes que escribir,
además del enrutamiento de Unreal.

### Por qué `pty` es importante incluso para los juegos de texto

En una tubería, la salida estándar de un programa C se almacena en búfer por completo, por lo que "la salida se ha silenciado durante N ms" puede significar *"todavía no se ha vaciado el búfer"* en lugar de *"está esperando tu respuesta"*. Una PTY restaura el almacenamiento en búfer de línea y hace que la regla de preparación tenga sentido. En Windows, una tubería no captura nada de un juego que dibuja a través de la API de la consola.

También corrige cómo se ve una actualización. Medido en la TUI de prueba: la cuadrícula contiene
**115 caracteres de una pantalla actual**, mientras que la vista de adición de líneas contiene **416
caracteres** de tres actualizaciones apiladas con la entrada del jugador intercalada y *tres valores de HP contradictorios*. El modelo tiene que adivinar cuál es el valor actual.

`pty` necesita los `node-pty` y `@xterm/headless` opcionales. Se instalan versiones precompiladas
en Windows y macOS; node-pty se compila en Linux. Sin ellos, el controlador falla con un error codificado que indica el comando de instalación; el resto no se ve afectado.

## Cuánto ve realmente cada jugador

Un modelo de jugador que no explora produce un informe confiado sobre un juego que apenas ha analizado. Por lo tanto, cada ejecución conlleva un bloque de cobertura calculado únicamente a partir de los registros de las jugadas, sin instrumentación ni llamadas adicionales al modelo: la curva de novedad y la vida media, las tasas de repetición/bucle/autobucle, la entropía de la acción y una simple lectura de `thin` / `moderate` / `broad` con las razones.

Esto vale la pena porque el fracaso se mide, no es teórico. Los agentes LLM orientados a tareas repiten su acción anterior el 63,4% de las veces, con una tasa de bucle del 16,0%, en comparación con el 24,9% / 7,7% de los agentes *entrenados* para la exploración ([Ye et al. 2026](https://arxiv.org/html/2605.16143)). Interprete esto como el rango en el que realmente se encuentra la repetición del agente, no como algo que una cadena de personalidad compra, ya que simplemente indicar a un agente que explore solo vale +2,57 en promedio en la métrica pass@1 ([Englander et al. 2026](https://arxiv.org/html/2604.17609)). Una baja entropía de la acción también indica un éxito *bajo* en lugar de eficiencia, por lo que una transcripción ordenada con pocas entradas distintas es una señal de advertencia, no algo bueno.

## Cómo interpretar un veredicto

**Las clasificaciones son importantes; no confíe en las puntuaciones absolutas.** Esta es la advertencia más importante de la herramienta y proviene de dos fuentes independientes. Los jueces LLM de la calidad narrativa alcanzan un nivel sistémico de τ ≈ 0,70, en comparación con un límite humano de 0,73, pero un nivel de historia de solo 0,16–0,25, apenas por encima de BERTScore ([Chhun et al. 2024](https://arxiv.org/abs/2405.13769)). Las pruebas automatizadas confirman lo mismo: las tasas de éxito de la IA se correlacionan con las tasas de éxito humanas con ρ = 0,80 en 95.266 jugadores ([Roohi et al. 2021](https://arxiv.org/abs/2107.12061)), mientras que la habilidad absoluta del agente no se transfiere en absoluto.

Por lo tanto, "la versión B obtuvo una puntuación peor que la versión A en *reacciona-al-jugador*" es una afirmación que esta herramienta respalda. "Este juego está vivo: sí" no lo es, y el informe está escrito para mantener esa distinción visible.

**Una brecha conocida, declarada claramente:** no encontramos ningún estudio que mida el acuerdo entre los problemas encontrados por los evaluadores automatizados y los problemas encontrados por los evaluadores humanos *en lo que respecta a la calidad de la experiencia*. Las pruebas automatizadas se validan únicamente en función de la dificultad y la competencia. La premisa central de la herramienta, que las confusiones de un modelo se asemejan a las de un jugador, no se ha probado en la literatura, en ningún caso. Considere los puntos débiles y las confusiones como pistas a verificar, no como hallazgos.

## Cómo funciona

1. **Observar.** El controlador produce un `Observation`: siempre `text`, opcionalmente un `grid` terminal, estructurado `state`, un archivo adjunto `image` y los `actions` que son legales en este momento. También registra *cómo* supo que era el turno del jugador: un indicador emitido por el juego, una señal de preparación terminal, un patrón de solicitud o una suposición de inactividad, para que pueda distinguir el conocimiento de la inferencia.
2. **Configuración programada.** Las indicaciones que coinciden con una expresión regular `setup[].match` se responden desde la configuración, sin el jugador y sin consumir un turno, de modo que cada familia comience desde el mismo personaje.
3. **El jugador** ve la pantalla desde su última entrada, más sus últimas `playerMemoryTurns` interacciones, y recibe información de `persona` (objetivos y registro, nunca la mecánica que se está probando), y responde con una línea. Las respuestas incorrectas se revierten a `look`.
4. **Actuar.** Cuando la observación contiene `actions`, la respuesta limpia se asigna a `choose` / `key` / `line`. Una falta en un conjunto cerrado es un evento de la herramienta de prueba: el ejecutor no gasta un turno del juego en ella. La configuración y la salida permanecen en `kind:line`.
5. **Salir.** Después de `turns` entradas, el ejecutor envía `quitInputs` (por ejemplo, `save`, `quit`). Estas son las entradas del *ejecutor*: se excluyen del recuento de turnos y de la evidencia, mientras que las pantallas terminales que producen se conservan: un bloqueo o un resumen de guardado son evidencia.
6. **El jurado** (un asiento con el autor ausente por defecto, temperatura 0) evalúa la transcripción en función de `criteria[]`. Los jurados adicionales (si `panelSize` > 1) señalan el desacuerdo; no se promedian en una puntuación más alta. La lectura del asiento de juego es un testimonio.
7. **Las comprobaciones deterministas** se ejecutan en los registros de turnos: SCC absorbente (Tarjan, nunca etiquetado como una trampa), atribución de entrada ignorada, expresiones regulares opcionales de analizador/victoria/muerte, ventanas de falta de progreso, pistas de aparición de entidades y (cuando `state` es un objeto) invariantes de HP/inventario.
8. **El informe** agrega: criterios por familia con divisiones de jurado marcadas, cobertura como un calificador de muestreo, el bloque de verificación y cada punto débil y confusión nombrados: primero los hallazgos del jurado, luego el testimonio del autor. Los glifos (`!`, `H(a)`, `repeat`, `loop`) se explican en la página.

Artefactos por asiento bajo `<runsDir>/<label>/<seat>/`: `transcript.txt`, `critique.json`, `meta.json` (anclajes `schemaVersion` + `toolVersion`), `stderr.txt` (cuando el juego escribió algo). `REPORT.md` y `REPORT.json` (`kind: "single-run-report"`) en la raíz de la etiqueta.

## Uso

```bash
export OPENROUTER_API_KEY=...
npm run build
node dist/cli.js run path/to/game.playtest.json --label phase9
node dist/cli.js run path/to/game.playtest.json --label smoke --seats mistral --turns 8
node dist/cli.js run path/to/game.playtest.json --label compare --runs 3   # descriptive; cannot reach p<0.05
node dist/cli.js run path/to/game.playtest.json --label rpc --serial       # one game, several seats; needed for RPC until you multiplex
node dist/cli.js report path/to/game.playtest.json --label phase9   # rebuild REPORT.md + REPORT.json from disk
```

`--serial` ejecuta los asientos uno tras otro. En el controlador RPC, reutiliza un cliente TCP y llama a `reset()` entre los asientos. Sin `--serial`, cada asiento RPC es su propio proceso; competirán si comparten un juego de escucha.

Códigos de salida: 0 correcto · 1 uso · 2 configuración · 3 proveedor (falta la clave, el modelo no tiene puntos finales) · 4 error de ejecución (cada asiento terminó en error, o ningún asiento produjo un veredicto). Los errores imprimen `error:` y `hint:`.

## Referencia de configuración

| clave | significado |
|---|---|
| `name` | nombre de la prueba (título del informe) |
| `driver` | `{"kind":"stdio"}` (predeterminado), `{"kind":"pty","cols":100,"rows":30,"readySentinel":"..."}` o `{"kind":"rpc","port":7777,"host":"127.0.0.1"}` |
| `game.command`, `game.args`, `game.cwd` | cómo generar el juego; `cwd` se resuelve en relación con el archivo de configuración. No es necesario para el controlador `rpc`, que se adjunta a un juego en ejecución |
| `game.env` | variables de entorno adicionales para el juego; un valor `$NAME` lee las variables de entorno del ejecutor |
| `game.inheritEnv` | pasar todo el entorno del ejecutor al juego. **Desactivado por defecto**, consulte a continuación |
| `game.promptPatterns` | expresiones regulares que significan "esperando una línea", probadas en relación con la cola eliminada (`stdio`) o la línea del cursor renderizada (`pty`) |
| `game.promptQuietMs` / `idleQuietMs` / `screenTimeoutMs` | la regla de espera (predeterminado 800 / 6000 / 180000 ms) |
| `game.quitInputs` | líneas enviadas después del último turno (predeterminado `["quit"]`) |
| `seats[]` | `{ id, family, model }`: identificadores de OpenRouter; un asiento por familia |
| `panelSize` | jurados "author-off" por transcripción (valor predeterminado: **1**; aumentar para indicar desacuerdo, no para obtener una puntuación más alta). |
| `verifiers` | listas opcionales de expresiones regulares (`unparsed`, `refused`, `victory`, `death`; vacío = no adivinar). Ocupación: `absorbingMinTurns` (valor predeterminado: 4), `noProgressWindow` (valor predeterminado: 5), `noOpVerbs` |
| `setup[]` | `{ match, answer }`: respuestas predefinidas para las indicaciones de configuración |
| `turns` | entradas de juego por asiento (las respuestas de configuración y las entradas de salida no se cuentan; valor predeterminado: 40) |
| `persona` | la descripción del juego |
| `criteria[]` | `{ id, check }`: los propios criterios de "estar vivo" del juego |
| `screenChars` | caracteres de la pantalla que se conservan por turno (valor predeterminado: 6000) |
| `playerMemoryTurns` | turnos recientes que ve el jugador (valor predeterminado: 8) |
| `playerTemperature` | temperatura de muestreo del jugador (valor predeterminado: 0,7); el crítico siempre es 0 |
| `runsDir` | dónde se escriben las ejecuciones (valor predeterminado: `runs`, se resuelve en relación con el archivo de configuración) |

Una configuración de ejemplo: `claude-rpg/dogfood/playtest/claude-rpg.playtest.json` (el
narrador de Claude incluido se ejecuta a través del punto final compatible con Anthropic de OpenRouter — `ANTHROPIC_BASE_URL=https://openrouter.ai/api`, la aplicación SDK agrega
`/v1/messages` — con la anulación de nombres `CLAUDE_RPG_MODEL` del juego, que asigna un
identificador `anthropic/...`).

### Una nota sobre `game.inheritEnv`

El proceso del juego obtiene una pequeña lista de permitidos más su `game.env`, y **no**
`OPENROUTER_API_KEY`. Esto no siempre fue así: la clave antes llegaba al
juego y se observaba que se mostraba como texto en la pantalla, desde donde fluía hacia el
contexto del jugador y el informe escrito. Si tiene ejecuciones anteriores a esa corrección,
considere que la clave utilizada para ellas está expuesta. `inheritEnv: true` restaura la
herencia completa; úselo solo para un juego en el que confíe tanto como en el propio ejecutor.

Consulte [SECURITY.md](SECURITY.md) para obtener la descripción completa.

## Modelo de confianza

**Datos accedidos:** el archivo JSON de la prueba de juego, cualquier cosa que `game.command` / el puente RPC
imprima, las respuestas del chat de OpenRouter (jugador + jurado) y los archivos que
el ejecutor escribe en `runsDir` (`transcript.txt`, `critique.json`,
`meta.json`, `REPORT.md`, `REPORT.json`).

**Datos no accedidos:** el ejecutor no envía ninguna telemetría ni recopila ninguna
analítica. El proceso del juego no recibe `OPENROUTER_API_KEY` a menos que
configure `game.inheritEnv: true`. No se escribe nada fuera de `runsDir`.

**Permisos:** `game.command` es `child_process.spawn`: una configuración de prueba de juego es equivalente a un archivo ejecutable. Revíselo como lo haría con un script de shell.
El HTTPS saliente es solo la URL base de OpenRouter configurada. No hay
entorno de pruebas.

## Telemetría

Ninguna. No hay analítica, ni informe de fallos, ni "llamada a casa". La única llamada de red
es la que configuró para los modelos.

## Cumplimiento de estándares (estándares de flujo de trabajo, puntuación de 0 a 3)

- **PIN_PER_STEP — 2.** Cada asiento asigna su identificador de modelo; las indicaciones del jugador y del crítico
son constantes de código; la configuración es la entrada que se puede volver a reproducir. OpenRouter no asigna
el enrutamiento del proveedor, por lo que una reproducción es idéntica en términos de indicaciones, no en términos de bytes.
*Solución: registre el proveedor elegido por llamada en `meta.json`.*
- **ANDON_AUTHORITY — 2.** Un asiento que se detiene (`screenTimeoutMs`), sale antes de tiempo o
agota los reintentos termina con una razón registrada; una ejecución en la que ningún asiento produjo un
veredicto sale con el valor 4 en lugar de 0, por lo que un fallo de crítica silencioso no se puede interpretar como correcto.
- **NAMED_COMPENSATORS — omitir:** el único artefacto del ejecutor es el directorio de ejecución;
eliminarlo es la única forma de deshacerlo. Los efectos secundarios del *juego* son propios y
están fuera del control del ejecutor, que es exactamente por lo que una configuración de prueba de juego se
trata como equivalente a un archivo ejecutable.
- **DECOMPOSE_BY_SECRETS — 3.** `driver.ts` es la división de observación,
`openrouter.ts` es la única división de red, `panel.ts` es la división de evaluación; cada una tiene
sus propias pruebas y una versión simulada en el otro lado.
- **UNCERTAINTY_GATED_HUMANS — 3.** El informe agrega pero nunca decide, y
indica su propia incertidumbre: los veredictos divididos, la cobertura limitada, una advertencia de muestra única y los criterios que ningún juez respondió se muestran en lugar de suavizarse.
- **EXTERNAL_VERIFIER — 3.** Cada transcripción es evaluada por una familia que no la
produjo (valor predeterminado: un asiento "author-off"; aumente `panelSize` para indicar
desacuerdo), y el desacuerdo se informa. **Esto obtuvo una puntuación de 3 mientras que el
código hacía lo contrario** hasta el enjambre del 14 de septiembre de 2026; el crítico era el mismo
modelo que jugaba. La afirmación ahora coincide con la implementación, y `pickJurors`
devuelve un jurado vacío en lugar de recurrir al autor.

## Desarrollo

```bash
npm install
npm run verify      # typecheck (src AND tests) + vitest
npm run coverage    # vitest --coverage
```

182 pruebas. `tsconfig.test.json` existe porque la configuración de compilación excluye los archivos de prueba, lo que significaba que ningún archivo de prueba era verificado por ningún sistema; detectó errores de tipo reales en su primera ejecución.

---

Creado por [MCP Tool Shop](https://mcp-tool-shop.github.io/).
