# Mosaic Crochet Designer — Especificação v0.1

Fonte: engenharia reversa do app "BETA Overlay Mosaic Crochet Design Tool" (Sharon Machlis,
apps.machlis.com/shiny/crochetapp). App original é R Shiny (DT + gt); lógica no servidor, código
não público. Regras abaixo foram inferidas e **validadas empiricamente** (toggle → generate → diff).

## 1. Objetivo
App 100% client-side para desenhar padrões de *overlay mosaic crochet* com feedback instantâneo
(gráfico, conflitos e instruções recalculados a cada clique), sem Excel e sem servidor.

## 2. Modelo de dados
- `rows` ímpar, 5–51; `cols` 5–50. Linha 1 = base (embaixo). Coluna 1 = esquerda.
- `main` (fundo) e `pattern` (cor do padrão): qualquer cor CSS.
- Estado mínimo: matriz booleana `delta[r][c]` (desvio da listra). Cor visual é derivada.

## 3. Regras (núcleo — implementar como funções puras)
1. **Listra padrão:** `stripe(r) = r ímpar ? main : pattern`. Rows ímpar ⇒ começa e termina em `main`.
2. **Toggle:** clicar inverte a cor da célula em relação à listra. `delta[r][c] = color[r][c] ≠ stripe(r)`.
3. **Ponto alto (dc):** `X[r+1][c] = delta[r][c]`. O dc da linha r+1 entra na alça da frente de r−1,
   cobrindo (r,c) com a cor de r+1 (= cor de r−1).
4. **Conflito:** célula com `X[r][c] && (X[r−1][c] || X[r+1][c])` — dc em linhas consecutivas. Destacar em vermelho.
5. **Linha do topo** (`r = rows`): toggle não gera dc (não existe r+1).
6. **Instruções:** cada linha lida da **direita para a esquerda** (col `cols` → 1), todas pelo lado
   direito (sem virar). Agrupar sequências: `"Row N: 8 sc, 1 dc, 3 sc, 1 dc and 4 sc"` — vírgulas,
   `and` antes do último grupo; linha sem dc → `"Row N: 20 sc"`. Cabeçalho do gráfico numera colunas
   da direita (cols…1); geometria do desenho NÃO é espelhada.

## 4. Bugs do original — NÃO replicar
- Toggle na **linha 1** gera X na linha 2 (dc sem linha abaixo para entrar) e o gráfico não mostra a
  mudança. → Bloquear toggle nas linhas 1 e `rows` (com feedback visual).
- Conflitos só aparecem após "Generate". → Mostrar ao vivo.
- Mudar dimensões/cores apaga o desenho. → Redimensionar preservando o conteúdo; cores só restilizam.
- Sem persistência. → Autosave local + export/import JSON.

## 5. Vetores de teste (saída real do app original, grid 15×20)
**Caso A** — toggles `(r,c)`: (5,5), (5,8), (10,8)
```
Row 6: 12 sc, 1 dc, 2 sc, 1 dc and 4 sc
Row 11: 12 sc, 1 dc and 7 sc
(todas as demais: 20 sc)
```
**Caso B** — Caso A + (6,5), (3,12), (4,12), (5,12), (15,10)
```
Row 4: 8 sc, 1 dc and 11 sc
Row 5: 8 sc, 1 dc and 11 sc
Row 6: 8 sc, 1 dc, 3 sc, 1 dc, 2 sc, 1 dc and 4 sc
Row 7: 15 sc, 1 dc and 4 sc
Row 11: 12 sc, 1 dc and 7 sc
(demais: 20 sc)
Conflitos (vermelho): col 5 linhas 6–7; col 12 linhas 4–6. Toggle (15,10): sem dc.
```
(O original também aceitava (1,3) → "Row 2: 17 sc, 1 dc and 2 sc"; no novo app isso é bloqueado — §4.)

## 6. Escopo do MVP (marco 1 — paridade instantânea, 2 cores)
- Grade em Canvas (ou SVG) com pintar arrastando; desfazer/refazer.
- Painel ao vivo: gráfico com X + conflitos, instruções escritas.
- Autosave (localStorage com try/catch), export PNG/JSON, import JSON.

## 7. Backlog (fora do MVP — decidir antes de iniciar)
- Linhas viradas (muda numeração/direção das instruções).
- >2 cores (muda o modelo de dados).
- Espelho/simetria, repetição de motivo, colunas de borda, auto-correção de conflitos, export PDF.

## 8. Stack sugerida
Vite + React + TypeScript; Vitest para o núcleo (`src/core/` puro, sem React). Deploy estático.
