# croche — Mosaic Crochet Architect

Editor de padrões de *overlay mosaic crochet* com contas e biblioteca de padrões salvos no seu
próprio servidor. Regras em [`SPEC.md`](SPEC.md); deploy no VPS em [`docs/DEPLOY.md`](docs/DEPLOY.md).

- **Simulation**: clique troca a cor da célula; o dc é colocado sozinho na linha de cima.
- **Schematic**: clique coloca/remove o X (dc); ele cobre a célula logo abaixo.
- Conflitos (dc em linhas consecutivas na mesma coluna) em vermelho, ao vivo.
- Instruções escritas por linha, Invert (troca A↔B), Clear, export CSV (1 = dc) e JSON.

## Desenvolvimento

```sh
npm install
npm run dev          # SPA em http://localhost:5173 (o Vite repassa /api para o backend)
npm run dev:server   # backend em http://127.0.0.1:3000, em outro terminal; banco em ./data/
npm run cli:dev -- user:create voce@exemplo.com   # primeira conta (o cadastro público vem desligado)
```

```sh
npm test             # Vitest: núcleo em src/core (golden tests da SPEC §5) e backend
npm run build        # SPA em dist/ + backend em dist-server/
npm start            # roda o build (configuração por variáveis de ambiente: .env.example)
```

Produção (Docker Compose + Caddy, ou Node + systemd + nginx), backups e atualizações:
[`docs/DEPLOY.md`](docs/DEPLOY.md).
