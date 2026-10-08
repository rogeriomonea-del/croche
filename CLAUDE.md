# CLAUDE.md — Mosaic Crochet Designer

Leia `SPEC.md` antes de qualquer mudança: é a fonte da verdade das regras.

## Convenções
- Núcleo em `src/core/` como funções puras (stripe, deriveX, conflicts, instructions, document). Zero dependência de UI.
- Contrato HTTP em `src/shared/` (tipos e validadores usados pela SPA e pelo servidor). Backend em `server/` (SPEC §9).
- Todo comportamento do §3 da SPEC tem teste; os vetores do §5 são testes obrigatórios (golden tests).
- Não replicar os bugs listados no §4.
- Escopo = §6 (MVP). Itens do §7 só com decisão explícita do Ro.

## Comandos
- `npm run dev` — SPA (Vite, proxy de `/api` para :3000) · `npm run dev:server` — API com reload
- `npm run cli:dev -- user:create voce@exemplo.com` — cria conta local
- `npm test` — Vitest (precisa passar antes de declarar qualquer tarefa concluída)
- `npm run build` — SPA (`dist/`) + servidor (`dist-server/`) · `npm start` — produção
- Deploy no VPS: `docs/DEPLOY.md`
