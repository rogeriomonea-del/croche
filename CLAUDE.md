# CLAUDE.md — Mosaic Crochet Designer

Leia `SPEC.md` antes de qualquer mudança: é a fonte da verdade das regras.

## Convenções
- Núcleo em `src/core/` como funções puras (stripe, deriveX, conflicts, instructions). Zero dependência de UI.
- Todo comportamento do §3 da SPEC tem teste; os vetores do §5 são testes obrigatórios (golden tests).
- Não replicar os bugs listados no §4.
- Escopo = §6 (MVP). Itens do §7 só com decisão explícita do Ro.

## Comandos
- `npm run dev` — servidor local
- `npm test` — Vitest (precisa passar antes de declarar qualquer tarefa concluída)
- `npm run build` — build estático
