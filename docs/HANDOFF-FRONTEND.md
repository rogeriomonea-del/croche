# Handoff: retrabalho do frontend

Guia para quem for melhorar a interface (pessoa ou outra IA). O backend, o núcleo de regras e o
deploy estão prontos e testados; o frontend pode mudar à vontade **desde que** respeite o que está
abaixo. Regras completas em `SPEC.md`.

## O que pode mudar livremente
`src/App.tsx`, `src/components/`, `src/state/`, `src/lib/`, `src/index.css`, `index.html`, visual,
layout, textos, ícones, novas telas.

## O que não muda sem atualizar `SPEC.md` e os testes
- `src/core/` — regras do overlay mosaic (listras, desvios, dc, conflitos, instruções, documento JSON).
  Os golden tests (`src/core/golden.test.ts`, SPEC §5) são saída real do app original: não editar.
- `src/shared/` — contrato HTTP usado pela SPA **e** pelo servidor.
- `server/`, `Dockerfile`, `docker-compose.yml`, `deploy/`, `docs/DEPLOY.md`.

## Invariantes do frontend
1. **Um booleano por célula.** O estado é `delta[r][c]` (a célula desvia da cor da listra?). Cor
   visível (`cellYarn`) e X/dc (`deriveX`) são **derivados**. Não guardar `visualColor`, `type` ou
   `isAnchorValid` por célula, nem um ciclo de 3 cliques (cor → X → limpo): o X na linha r+1 é
   exatamente o que faz a célula (r, c) mostrar a outra cor, então guardar os dois separados permite
   desenhar coisas impossíveis de crochetar.
2. **Clique passa por `resolveClick(view, r, c, rows)` + `toggle`.** Simulation: o clique troca a cor
   da célula. Schematic: o clique põe/tira o X (que cobre a célula de baixo). Linhas travadas
   (1 e topo na Simulation; 1 e 2 na Schematic) recusam com mensagem (`BlockedReason`).
3. **Conflitos** via `conflicts(deriveX(delta))` e `conflictOutline(view, …)` para posicionar o
   contorno. **Instruções** via `instructions()`. Cabeçalho de colunas via `stitchNumber` (da direita).
4. **Limites** de `ROW_OPTIONS` / `COL_OPTIONS` (linhas ímpares, até 119 × 120).
5. **Persistência só pela API** (`src/api/client.ts`). Documento sempre por `toDocument` /
   `parseDocument`. Salvar envia `revision`; `409 revision_conflict` traz `details.current`.
6. **CSP estrita** (`default-src 'self'`, `style-src 'self'`): nada de `<script>`/`<style>` inline,
   CDN de fontes/scripts ou bibliotecas CSS-in-JS que injetam `<style>`. Classes Tailwind e a prop
   `style` do React funcionam.
7. **Desempenho:** 119 × 120 = 14.280 células; hoje um clique repinta em ~11 ms. Manter linhas
   memoizadas (ver `MosaicGrid`).

## Como rodar e validar
```
npm ci
npm test                         # 356 testes; todos precisam passar
npm run build                    # SPA + servidor
npm run cli:dev -- user:create voce@exemplo.com   # conta local
npm run dev:server               # API em :3000
npm run dev                      # SPA em :5173 (proxy /api)
```
Ao devolver: o repositório **inteiro** (não só arquivos alterados), com `npm test` e `npm run build`
verdes e sem alterar `src/core/golden.test.ts`.

## Pendências conhecidas (backend, baixa prioridade)
- `GET /%61pi/nope` devolve `index.html` em vez de JSON 404 (cosmético).
- Migrações não são seguras com dois processos ao mesmo tempo (o app roda um processo só).
- Sem teste automatizado de redação de cookies no log.
- `emailError` exige ponto no domínio (`ro@localhost` é recusado): decisão de produto em aberto.
