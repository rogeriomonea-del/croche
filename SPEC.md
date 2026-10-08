# Crochet Victorioso — Especificação v0.3

Fonte: engenharia reversa do app "BETA Overlay Mosaic Crochet Design Tool" (Sharon Machlis,
apps.machlis.com/shiny/crochetapp). App original é R Shiny (DT + gt); lógica no servidor, código
não público. Regras abaixo foram inferidas e **validadas empiricamente** (toggle → generate → diff).

## 1. Objetivo
App web para desenhar padrões de *overlay mosaic crochet* com feedback instantâneo (gráfico,
conflitos e instruções recalculados a cada clique no navegador), sem Excel. Desde a v0.2 roda no VPS
do Ro: SPA + backend Node com contas e persistência (§9). O núcleo `src/core/` é o mesmo nos dois
lados: o servidor valida e deriva com as mesmas funções puras que a UI usa.

## 2. Modelo de dados
- `rows` ímpar, 5–119; `cols` 5–120 (v0.2, decisão do Ro: "até 120×120"; ímpar ⇒ máx. 119).
  Linha 1 = base (embaixo). Coluna 1 = esquerda.
- `main` (fundo, cor **A**) e `pattern` (cor do padrão, cor **B**): hex `#rrggbb`.
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

## 9. Backend (v0.2 — decisões do Ro em 2026-10-08)
Contas com cadastro controlado, SQLite, hospedagem no VPS próprio. Excel deixa de ser alvo: CSV é
RFC 4180 puro (sem linha `sep=`).

### 9.1 Stack e layout
- Node 22 + TypeScript, Fastify 5, better-sqlite3 (WAL), @node-rs/argon2, @fastify/cookie,
  @fastify/rate-limit, @fastify/helmet, @fastify/static. Testes em Vitest com `app.inject` e SQLite
  `:memory:`.
- `server/` = backend; `src/` = SPA; `src/core/` = domínio puro compartilhado; `src/shared/api.ts` =
  tipos e validadores do contrato HTTP, compartilhados pelos dois lados.
- Um processo serve API (`/api/*`) e a SPA buildada (fallback para `index.html`).

### 9.2 Contas e sessões
- E-mail normalizado (trim + minúsculas, ≤ 254, um `@`, sem espaços nem caracteres de controle).
  Senha 10–256 caracteres, sem regras de composição (NIST 800-63B). Hash argon2id (m = 19 MiB,
  t = 2, p = 1).
- Cadastro público só com `ALLOW_SIGNUP=true` (padrão `false`). Contas também por CLI.
- Nome de login opcional atribuído por `user:alias <email> "<nome>"`: 3–80 caracteres Unicode,
  letras/números/espaços/pontos/apóstrofos/sublinhados/hífens, ao menos uma letra ou número,
  sem `@` nem controles. Nome de exibição em NFC, trim e espaços consecutivos reduzidos a um;
  busca em minúsculas após a mesma normalização, com NFC reaplicado após converter minúsculas
  para garantir idempotência. O intervalo de 3–80 caracteres vale tanto para o nome de exibição
  quanto para a chave normalizada (algumas maiúsculas Unicode expandem ao converter).
  Um nome único por conta, substituível pela CLI.
  O e-mail continua válido para login; cadastro público continua exigindo e-mail.
  A migração 2 acrescenta `user_aliases` sem alterar usuários, sessões ou padrões existentes;
  a exclusão do usuário remove o nome por `ON DELETE CASCADE`.
- Login com e-mail/nome inexistente ou senha errada: mesma resposta (`401 invalid_credentials`) e tempo
  equivalente (verifica contra hash fictício).
- Sessão: token aleatório de 32 bytes no cookie; o banco guarda só o SHA-256. Cookie `HttpOnly`,
  `SameSite=Lax`, `Path=/`, `Secure` quando `COOKIE_SECURE` (nome `__Host-mosaic_session`; sem
  Secure, `mosaic_session`). Expiração deslizante de `SESSION_TTL_DAYS` (padrão 30).
- Troca de senha encerra as outras sessões do usuário. Exclusão de conta apaga sessões e padrões.

### 9.3 Segurança HTTP
- Requisição com corpo exige `Content-Type: application/json` (senão 415). Corpo ≤ 256 KiB.
- POST/PUT/PATCH/DELETE com cabeçalho `Origin` diferente de `PUBLIC_ORIGIN` → `403 bad_origin`.
- Rate limit: 300 req/min por IP em `/api`; login, cadastro, troca de senha e exclusão de conta
  10/min por IP; 10 senhas erradas por conta em 15 min (somando login por nome ou e-mail, troca de
  senha e exclusão de conta) bloqueiam a conta até a janela fechar (`429 rate_limited`).
  Para contas existentes, a chave de bloqueio é sempre o e-mail canônico; identificadores
  desconhecidos são contados pelo nome/e-mail normalizado.
  Custo aceito: como nome e e-mail da conta compartilham o bloqueio, quem trava uma conta pelo nome
  de login vê `429` ao tentar o e-mail dessa conta e `401` em e-mails inexistentes, ligando o nome ao
  e-mail. Fora de um bloqueio, identificador inexistente e senha errada seguem indistinguíveis.
- Helmet com CSP `default-src 'self'` (sem `unsafe-inline`), `frame-ancestors 'none'`.
- Log sem corpo de requisição; cookies e `set-cookie` redigidos.
- Padrão de outro usuário responde `404`, nunca `403`. IDs são UUID v4.

### 9.4 API (`/api`, JSON)
Erro: `{ "error": { "code", "message", "details"? } }`. Datas em ISO 8601.

| Método e rota | Corpo | Sucesso | Erros |
|---|---|---|---|
| `GET /health` | | `200 {ok:true}` | |
| `GET /auth/config` | | `200 {signupEnabled}` | |
| `POST /auth/signup` | `{email,password}` | `201 {user}` + cookie | 400 `invalid_input`, 403 `signup_disabled`, 409 `email_taken` |
| `POST /auth/login` | `{email,password}` (`email` aceita e-mail ou nome de login) | `200 {user}` + cookie | 400, 401 `invalid_credentials`, 429 |
| `POST /auth/logout` | | `204` | |
| `GET /auth/me` | | `200 {user}` | 401 `unauthenticated` |
| `POST /auth/password` | `{currentPassword,newPassword}` | `204` | 400, 401, 429 |
| `POST /auth/delete-account` | `{password}` | `204` | 401, 429 |
| `GET /patterns` | | `200 {patterns: PatternSummary[]}` (mais recente primeiro) | 401 |
| `POST /patterns` | `{document}` | `201 {pattern}` | 400 `invalid_document`, 403 `pattern_quota_exceeded` |
| `GET /patterns/:id` | | `200 {pattern}` | 404 `not_found` |
| `PUT /patterns/:id` | `{revision,document}` | `200 {pattern}` (revision + 1) | 400, 404, 409 `revision_conflict` (`details.current`) |
| `DELETE /patterns/:id` | | `204` | 404 |
| `GET /patterns/:id/export.json` | | documento exportado (§10), anexo | 404 |
| `GET /patterns/:id/export.csv` | | CSV do gráfico X, anexo | 404 |

`user = {id,email,createdAt,displayName?}`; `displayName` só aparece quando há nome de login
atribuído, inclusive em `/auth/me`. `PatternSummary = {id,name,rows,cols,colors:{A,B},revision,createdAt,
updatedAt}`; `Pattern = PatternSummary + {document}`. Limite `MAX_PATTERNS_PER_USER` (padrão 500).

### 9.5 Configuração (env, validada no boot; valor inválido derruba o processo com mensagem clara)
`NODE_ENV`, `HOST` (127.0.0.1), `PORT` (3000), `DATABASE_PATH` (./data/mosaic.db), `PUBLIC_ORIGIN`
(obrigatório em produção), `ALLOW_SIGNUP` (false), `COOKIE_SECURE` (true em produção),
`TRUST_PROXY` (false), `SESSION_TTL_DAYS` (30), `MAX_PATTERNS_PER_USER` (500), `STATIC_DIR` (./dist),
`LOG_LEVEL` (info).

## 10. Documento do padrão (JSON v1)
Formato único para banco, API, export e import. Funções puras em `src/core/document.ts`.
```json
{ "format": "mosaic-crochet-pattern", "version": 1, "name": "Losangos",
  "rows": 15, "cols": 20, "colors": { "A": "#f3ead8", "B": "#0f766e" },
  "cells": ["00000000000000000000", "…"] }
```
- `cells[0]` = linha 1 (base); caractere `j` = coluna `j+1` (esquerda → direita); `'1'` = célula
  desvia da listra (`delta`), `'0'` = listra. `cells.length = rows`, cada string com `cols` chars.
- Linhas 1 e `rows` só com `'0'` (§4). `name`: 1–100 caracteres após trim, sem caracteres de controle.
  Cores `#rrggbb` (normalizadas para minúsculas).
- Chaves desconhecidas são ignoradas e não são armazenadas; `derived` também é ignorado no import.
- Export acrescenta `derived: { chart, instructions, conflicts }`: `chart` na mesma codificação de
  `cells` (`'1'` = dc), `instructions` como §3.6 e `conflicts` como lista `[r, c]`.
- `PATTERN_DOCUMENT_SCHEMA` (JSON Schema 2020-12) descreve a estrutura; as regras semânticas acima
  ficam em `parseDocument`.

## 11. Crochet Victorioso: modelos e conversão de fotografias (v0.3)

- A identidade visual pública é **Crochet Victorioso**, com interface em português.
- A galeria contém 20 modelos originais, divididos em quatro categorias com cinco modelos cada.
  A aplicação de um modelo cria uma cópia independente, validada pelo formato da seção 10,
  com confirmação antes de substituir alterações não salvas. Todos respeitam bordas e conflitos.
- O conversor aceita PNG, JPEG e WebP, até 12 MB e 24 megapixels. Decodificação, amostragem e
  conversão acontecem no navegador; a foto não é enviada nem persistida no servidor.
- A saída é uma aproximação do motivo visível em duas cores, sem inferir receitas tridimensionais,
  modelagem ou pontos escondidos. Há enquadramento proporcional (foto inteira ou recorte central),
  contraste automático/manual, inversão e dimensões nos limites originais (5–119 carreiras ímpares,
  5–120 pontos por carreira).
- A conversão usa luminância e programação dinâmica por coluna para minimizar o erro ponderado
  em relação ao limiar escolhido, mantendo as bordas protegidas e evitando desvios consecutivos.
  O resultado guarda apenas `delta`; cores, pontos altos, conflitos e instruções são derivados
  pelo núcleo existente. A saída pode ser refinada, salva e exportada como qualquer outro padrão.
- Modelos e fotos não alteram o núcleo, o ciclo de dois estados, os golden tests nem o contrato
  de persistência. A extensão de login por nome está documentada nas seções 9.2–9.4.
