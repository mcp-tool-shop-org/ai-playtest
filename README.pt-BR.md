<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.md">English</a>
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

Testes de IA com diversidade familiar para jogos de turnos. Os modelos de jogadores controlam um jogo —
através de um terminal, um pseudo-terminal ou um socket para o seu motor — um painel de
modelos de *outras* famílias avalia cada transcrição, e um relatório agrega os
verdictos, juntamente com a quantidade de jogo que cada sessão realmente observou.

Uma única sessão de jogo realizada por uma pessoa diz-lhe o que essa pessoa viu. Cinco famílias
jogando os mesmos quarenta turnos dizem-lhe o que o mundo faz.

Versão 1.0.0. Disponível em GitHub. Ainda não está no npm — clone-o ou utilize-o através de um caminho a partir de um repositório irmão.

## Quem avalia

A primeira coisa a saber, porque é a coisa que a maioria dessas ferramentas faz de errado: **um
assento nunca avalia o seu próprio jogo.** Cada transcrição é avaliada por um avaliador externo por padrão (`panelSize`, aumente-o para indicar discordância — não para obter uma pontuação mais alta), e a avaliação do próprio assento é mantida como *testemunho* —
onde houve confusão, o que tentou — nunca como a pontuação.

Essa distinção é fundamental. A maior parte da auto-preferência medida em avaliadores de LLM
revela-se ser competência, e não narcisismo (apenas ~10,4% excede um controlo correspondente em termos de capacidade em 37.448 pares — [Roytburg et al.
2026](https://arxiv.org/html/2601.22548)), **mas o resíduo concentra-se em
domínios subjetivos e desaparece em domínios verificáveis** — e "o mundo pareceu vivo" é tão subjetivo quanto um critério pode ser. Enquanto isso, a autocrítica diminui ativamente a precisão, onde um verificador externo a aumenta: Game-of-24 passa de 5% → 3% com autocrítica e → 38% com um verificador confiável ([Stechly et al.
2024](https://arxiv.org/abs/2402.08115)).

O padrão é **um avaliador externo**, não um painel de três avaliadores. [Verga et al.
2024](https://arxiv.org/abs/2404.18796) (PoLL) mostraram que um painel heterogéneo barato supera GPT-4 em termos de concordância humana com um custo 7–8 vezes menor (κ 0,763 vs. 0,627) —
isso é um argumento contra o pagamento por um avaliador *grande*, não um argumento de que três famílias produzem três votos independentes. [Kohli
2026](https://arxiv.org/abs/2605.29800) mediu nove avaliadores em sete
famílias em Kish **n_eff = 2,18**; o painel (72,0%) *não* superou o melhor avaliador único (71,8%); a correlação entre famílias foi de 0,389 vs. 0,437 na mesma família. Em
`panelSize: 3`, isso é **≈1,68 votos independentes**. Dawid–Skene não resolve
isso (≤11% da lacuna de Condorcet). [Kim et al. 2025](https://arxiv.org/abs/2506.07962)
constataram que os pares concordam em cerca de 60% das vezes quando ambos estão errados. Portanto, avaliadores adicionais são um indicador de discordância, não uma pontuação mais alta. **O orçamento foi transferido dos avaliadores para as sessões de jogo.**
`--runs 3` é descritivo, não um teste de significância; a CLI ainda define o padrão para
uma sessão, para que um teste rápido seja apenas uma sessão. n=3 nunca pode atingir p<0,05 (limite
`2/2^n` = 0,25). Consulte `docs/research-2.md` §A e `docs/research-3.md`.

Isso **não** anula a remoção do autor do seu próprio painel de avaliação, o que se baseia em
Panickssery / Stechly / Huang.

**A discordância é relatada, não atenuada.** Um veredicto dividido geralmente significa que o
*critério* está mal definido, e não que o jogo é ambíguo, portanto, as divisões são
marcadas com sua contagem e a dispersão de cada assento é apresentada.

Se apenas uma família estiver presente, não há avaliador válido. A ferramenta não devolve silenciosamente
a transcrição ao seu autor — ela não forma um painel e o relatório indica que o veredicto é autoavaliado e por que isso é fraco. A validação da configuração ainda se recusa a
colocar dois jogadores da mesma família: uma segunda família é o que torna um painel de avaliação externo possível ([Panickssery et al. 2024](https://arxiv.org/abs/2404.13076)).

## Controladores — como o jogo é observado

| controlador | canal | para |
|---|---|---|
| `stdio` | linhas | jogos de texto orientados por linhas (o padrão) |
| `pty` | uma grade de terminal renderizada | TUIs de tela cheia (ratatui, ncurses) |
| `rpc` | estado estruturado via TCP | Godot, Unreal, qualquer coisa que possa ser instrumentada |

A ordem é baseada no quão *estruturado* é o canal, e isso é intencional, e não uma questão de gosto. As observações da árvore de acessibilidade dobram aproximadamente o sucesso de apenas capturas de tela em [OSWorld](https://arxiv.org/abs/2404.07972) (12,24% vs.
5,26%); em [BALROG](https://arxiv.org/abs/2411.13543), *adicionar* visão diminuiu vários modelos (GPT-4o 32,34% → 22,56%); o jogo de pixels não estruturado está próximo de zero em [VideoGameBench](https://arxiv.org/abs/2505.18134) (0,48% de conclusão do jogo); e [Voyager](https://arxiv.org/abs/2305.16291), ainda o agente de jogo de mundo aberto mais forte, utilizou uma API estruturada e nunca viu um pixel.

Portanto, uma captura de tela é um *anexo* opcional em uma observação, nunca o único canal. **Se o seu jogo puder se descrever, ele deve fazê-lo** — consulte
[docs/engine-bridge.md](docs/engine-bridge.md) para um autoload Godot 4 que pode ser copiado e colado, onde `_observation()` e `_apply()` são as únicas funções que você precisa escrever,
além do roteamento do Unreal.

### Por que `pty` é importante, mesmo para jogos de texto

Em um pipe, o stdout de um programa C torna-se totalmente armazenado em buffer, portanto, "a saída ficou silenciosa por N ms" pode significar *"ainda não foi liberado"* em vez de *"está esperando por você"*. Um PTY restaura o armazenamento em buffer de linha e torna a regra de prontidão clara. No Windows, um pipe não captura nada de um jogo que desenha através da API do Console.

Isso também corrige como uma redesenho se parece. Medido no TUI de teste: a grade contém
**115 caracteres de uma tela atual**, enquanto a visualização de acréscimo de linha contém **416
caracteres** de três redesenhos empilhados com a entrada do jogador intercalada e *três valores de HP contraditórios*. O modelo tem que adivinhar qual é o valor atual.

`pty` precisa dos opcionais `node-pty` e `@xterm/headless`. Eles são instalados previamente no Windows e macOS; node-pty é compilado no Linux. Sem eles, esse controlador falha com um erro codificado que indica o comando de instalação — nada mais é afetado.

## Quanto cada assento realmente viu

Um modelo de jogador que não explora produz um relatório confiante sobre um jogo que mal observou. Portanto, cada sessão carrega um bloco de cobertura calculado apenas a partir dos
registros de turnos — sem instrumentação, sem chamadas de modelo adicionais: a curva de novidade e o tempo de meia-vida, as taxas de repetição/loop/auto-loop, a entropia da ação e uma simples
leitura de `thin` / `moderate` / `broad` com os motivos.

Isto vale a pena porque o fracasso é medido, não teórico.
Agentes LLM orientados para tarefas repetem a sua ação anterior em **63,4%** das vezes, com uma taxa de repetição de 16,0%, em comparação com 24,9% / 7,7% para agentes *treinados* para exploração ([Ye et al. 2026](https://arxiv.org/html/2605.16143)). Interprete isso como a faixa de repetição do agente, e não como algo que uma string de personalidade compra, pois simplesmente solicitar a um agente que explore vale apenas **+2,57** em média para a métrica pass@1 ([Englander et al. 2026](https://arxiv.org/html/2604.17609)). Baixa entropia de ação também indica *baixo* sucesso em vez de eficiência, portanto, um registro organizado com poucos inputs distintos é um sinal de alerta, não um bom sinal.

## Como ler um veredicto

**A classificação é construída; não confie em pontuações absolutas.** Esta é a ressalva mais importante na ferramenta e deriva de duas fontes independentes. Os avaliadores LLM da qualidade narrativa atingem um nível de sistema de τ ≈ 0,70, em comparação com um limite humano de 0,73, mas o nível de história de τ é de apenas 0,16–0,25 — ligeiramente acima de BERTScore ([Chhun et al. 2024](https://arxiv.org/abs/2405.13769)). O teste automatizado valida da mesma forma: as taxas de sucesso da IA acompanham as taxas de sucesso humanas em ρ = 0,80 em 95.266 jogadores ([Roohi et al. 2021](https://arxiv.org/abs/2107.12061)), enquanto a habilidade absoluta do agente não é transferida.

Portanto, "a construção B teve um desempenho pior do que a construção A em *reage ao jogador*" é uma afirmação que esta ferramenta suporta. "Este jogo está ativo: sim" não é, e o relatório é escrito para manter essa distinção visível.

**Uma lacuna conhecida, declarada de forma clara:** nenhum estudo que encontramos mede o acordo entre os problemas encontrados pelos testadores de jogos (agentes) e os problemas encontrados pelos testadores humanos *em relação à qualidade da experiência*. O teste automatizado é validado apenas em relação à dificuldade e competência. A premissa central da ferramenta — que as confusões de um modelo se assemelham às de um jogador — não é, portanto, testada na literatura em nenhum dos sentidos. Considere os pontos críticos e as confusões como pistas a serem verificadas, e não como conclusões.

## Como funciona

1. **Observar.** O driver produz um `Observation`: sempre `text`, opcionalmente um `grid` terminal, estruturado `state`, um anexo `image` e o `actions` que são legais no momento. Ele também registra *como* soube que era a vez do jogador — um sinalizador emitido pelo jogo, um sinal pronto do terminal, um padrão de prompt ou uma suposição de inatividade — para que você possa distinguir o conhecimento da inferência.
2. **Configuração programada.** Os prompts que correspondem a uma regex `setup[].match` são respondidos a partir da configuração, sem o jogador e sem consumir uma jogada, para que cada família comece com o mesmo personagem.
3. **O jogador** vê a tela desde o seu último input, mais as suas últimas `playerMemoryTurns` trocas, com informações fornecidas por `persona` (objetivos e registro — nunca a mecânica sob teste) e responde com uma linha. Respostas malformadas recorrem a `look`.
4. **Ação.** Quando a observação contém `actions`, a resposta limpa é mapeada para `choose` / `key` / `line`. Uma falha em um conjunto fechado é um evento de teste — o executor não gasta uma jogada do jogo com isso. A configuração e a saída permanecem em `kind:line`.
5. **Sair.** Após `turns` inputs, o executor envia `quitInputs` (por exemplo, `save`, `quit`). Esses são os inputs do *executor*: eles são excluídos da contagem de jogadas e das evidências, enquanto as telas do terminal que eles produzem são mantidas — uma falha ou um resumo de salvamento são evidências.
6. **O júri** — um assento com o autor ausente por padrão, temperatura 0 — avalia o registro em relação a `criteria[]`. Jurados adicionais (se `panelSize` > 1) sinalizam discordância; eles não são combinados em uma pontuação mais alta. A avaliação do assento do jogador é um testemunho.
7. **Verificações determinísticas** são executadas nos registros de jogadas: SCC absorvente (Tarjan, nunca rotulado como uma armadilha), atribuição de input ignorado, regexes opcionais de parser/vitória/morte, janelas de falta de progresso, pistas de aparência de entidade e (quando `state` é um objeto) invariantes de HP/inventário.
8. **O relatório** agrega: critérios por família com divisões de jurados marcadas, cobertura como um qualificador de amostragem, o bloco de verificação e cada ponto crítico e confusão nomeados — as conclusões do júri primeiro, o testemunho do autor mantido. Glifos (`!`, `H(a)`, `repeat`, `loop`) são legendados na página.

Artefatos por assento sob `<runsDir>/<label>/<seat>/`: `transcript.txt`, `critique.json`, `meta.json` (pins `schemaVersion` + `toolVersion`), `stderr.txt` (quando o jogo escreveu algo). `REPORT.md` e `REPORT.json` (`kind: "single-run-report"`) na raiz da etiqueta.

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

`--serial` executa os assentos um após o outro. No driver RPC, ele reutiliza um cliente TCP e chama `reset()` entre os assentos. Sem `--serial`, cada assento RPC é seu próprio processo — eles competirão se compartilharem um jogo de escuta.

Códigos de saída: 0 ok · 1 uso · 2 configuração · 3 provedor (chave ausente, o modelo não tem pontos de extremidade) · 4 erro de execução (cada assento terminou em erro, ou nenhum assento produziu um veredicto). Erros imprimem `error:` e `hint:`.

## Referência de configuração

| chave | significado |
|---|---|
| `name` | nome do teste de jogo (título do relatório) |
| `driver` | `{"kind":"stdio"}` (padrão), `{"kind":"pty","cols":100,"rows":30,"readySentinel":"..."}` ou `{"kind":"rpc","port":7777,"host":"127.0.0.1"}` |
| `game.command`, `game.args`, `game.cwd` | como gerar o jogo; `cwd` resolve em relação ao arquivo de configuração. Para `rpc`, defina `command` e `run` lê `PLAYTEST_BRIDGE_PORT=` do processo (essa porta tem precedência sobre `driver.port`). Deixe `command` vazio para se conectar a um jogo que já está em execução. Dois ou mais assentos com um comando precisam de `--serial` |
| `game.env` | variáveis de ambiente extras para o jogo; um valor `$NAME` lê a variável de ambiente do executor |
| `game.inheritEnv` | passe a variável de ambiente inteira do executor para o jogo. **Desativado por padrão** — veja abaixo |
| `game.promptPatterns` | regexes que significam "aguardando uma linha", testadas em relação à cauda removida (`stdio`) ou à linha do cursor renderizada (`pty`) |
| `game.promptQuietMs` / `idleQuietMs` / `screenTimeoutMs` | a regra de espera (padrão 800 / 6000 / 180000 ms) |
| `game.quitInputs` | linhas enviadas após a última jogada (padrão `["quit"]`) |
| `seats[]` | `{ id, family, model }` — OpenRouter slugs; um assento por família |
| `panelSize` | jurados com o autor ausente por registro (padrão **1**; aumente para sinalizar discordância, não para calcular uma pontuação mais alta) |
| `verifiers` | listas de regexes opcionais (`unparsed`, `refused`, `victory`, `death`; vazio = não adivinhar). Ocupação: `absorbingMinTurns` (padrão 4), `noProgressWindow` (padrão 5), `noOpVerbs` |
| `setup[]` | `{ match, answer }` respostas programadas para prompts de configuração |
| `turns` | inputs de jogo por assento (as respostas de configuração e os inputs de saída não contam; padrão 40) |
| `persona` | o briefing do jogador |
| `criteria[]` | `{ id, check }`, os critérios de "vida" do jogo |
| `screenChars` | número de personagens na tela mantidos por turno (padrão: 6000) |
| `playerMemoryTurns` | número de turnos recentes que o jogador vê (padrão: 8) |
| `playerTemperature` | temperatura de amostragem do jogador (padrão: 0,7); o crítico é sempre 0 |
| `runsDir` | onde as execuções são gravadas (padrão: `runs`, resolvido em relação ao arquivo de configuração) |

Uma configuração funcional: `claude-rpg/dogfood/playtest/claude-rpg.playtest.json` (o
narrador Claude incluído executa o endpoint compatível com Anthropic de OpenRouter — `ANTHROPIC_BASE_URL=https://openrouter.ai/api`, o SDK adiciona
`/v1/messages` — com a substituição `CLAUDE_RPG_MODEL` do jogo, nomeando um
identificador `anthropic/...`).

### Uma nota sobre `game.inheritEnv`

O processo do jogo recebe uma pequena lista de permissões, além do seu `game.env`, e **não**
`OPENROUTER_API_KEY`. Isso nem sempre foi verdade: a chave anteriormente alcançava o
jogo e era exibida como texto na tela, de onde fluía para o
contexto do jogador e o relatório escrito. Se você tiver execuções de antes dessa correção,
considere a chave usada para elas como exposta. `inheritEnv: true` restaura a
herança completa — use-a apenas para um jogo em que você confia tanto quanto o próprio executor.

Consulte [SECURITY.md](SECURITY.md) para obter a descrição completa.

## Modelo de confiança

**Dados acessados:** o JSON do teste, qualquer coisa que `game.command` / a ponte RPC
imprima, OpenRouter conclusões de chat (jogador + júri) e arquivos que o
executor grava em `runsDir` (`transcript.txt`, `critique.json`,
`meta.json`, `REPORT.md`, `REPORT.json`).

**Dados não acessados:** o executor não envia telemetria nem coleta
dados analíticos. O processo do jogo não recebe `OPENROUTER_API_KEY`, a menos que
você defina `game.inheritEnv: true`. Nada é gravado fora de `runsDir`.

**Permissões:** `game.command` é `child_process.spawn` — uma configuração de teste é equivalente a um arquivo executável. Analise-a como faria com um script de shell.
O HTTPS de saída é apenas a URL base configurada OpenRouter. Não há
sandbox.

## Telemetria

Nenhuma. Sem dados analíticos, sem relatório de falhas, sem comunicação com o servidor. A única chamada de rede é aquela que você configurou para os modelos.

## Conformidade com os padrões (padrões de fluxo de trabalho, pontuação de 0 a 3)

- **PIN_PER_STEP — 2.** Cada "assento" associa seu identificador de modelo; os prompts do jogador e do crítico
são constantes de código; a configuração é a entrada reproduzível. OpenRouter não associa
o roteamento do provedor, portanto, uma reprodução é idêntica em termos de prompt, não em termos de bytes.
*Correção: registre o provedor escolhido por chamada em `meta.json`.*
- **ANDON_AUTHORITY — 2.** Um "assento" que para (`screenTimeoutMs`), sai antecipadamente
ou esgota as tentativas termina com uma razão registrada; uma execução em que nenhum "assento" produziu um
veredicto termina com 4 em vez de 0, para que uma falha de crítica silenciosa não seja interpretada como "ok".
- **NAMED_COMPENSATORS — ignorar:** o único artefato do executor é o diretório de execução;
excluí-lo é o "desfazer" completo. Os efeitos colaterais do *jogo* são de sua própria responsabilidade e
estão fora do controle do executor — e é exatamente por isso que uma configuração de teste é
tratada como equivalente a um arquivo executável.
- **DECOMPOSE_BY_SECRETS — 3.** `driver.ts` é a "junção" de observação,
`openrouter.ts` é a única "junção" de rede, `panel.ts` é a "junção" de avaliação; cada uma tem
seus próprios testes e um simulacro do outro lado.
- **UNCERTAINTY_GATED_HUMANS — 3.** O relatório agrega, mas nunca decide, e declara sua própria incerteza: veredictos divididos, cobertura limitada, um aviso de "amostra de um único elemento" e critérios que nenhum juiz respondeu são todos apresentados em vez de suavizados.
- **EXTERNAL_VERIFIER — 3.** Cada transcrição é avaliada por uma família que não a
produziu (padrão: um "assento" com um autor diferente; aumente `panelSize` para indicar
discordância), com a discordância sendo relatada. **Isso obteve uma pontuação de 3, enquanto o
código fazia o oposto** até o enxame de 14 de setembro de 2026 — o crítico era o mesmo
modelo que jogava. A afirmação agora corresponde à implementação, e `pickJurors`
retorna um júri vazio em vez de recorrer ao autor.

## Desenvolvimento

```bash
npm install
npm run verify      # typecheck (src AND tests) + vitest
npm run coverage    # vitest --coverage
```

182 testes. `tsconfig.test.json` existe porque a configuração de compilação exclui os arquivos de teste, o que significava que nenhum arquivo de teste era verificado quanto ao tipo por nada — ele detectou erros de tipo reais em sua primeira execução.

---

Criado por [MCP Tool Shop](https://mcp-tool-shop.github.io/).
