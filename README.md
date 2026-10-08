# croche — Mosaic Crochet Architect

Editor 100% client-side de padrões de *overlay mosaic crochet*. Regras em [`SPEC.md`](SPEC.md).

- **Simulation**: clique troca a cor da célula; o dc é colocado sozinho na linha de cima.
- **Schematic**: clique coloca/remove o X (dc); ele cobre a célula logo abaixo.
- Conflitos (dc em linhas consecutivas na mesma coluna) em vermelho, ao vivo.
- Instruções escritas por linha, Invert (troca A↔B), Clear, export CSV (1 = dc).

```
npm install
npm run dev     # servidor local
npm test        # Vitest: núcleo puro em src/core + golden tests da SPEC §5
npm run build   # build estático em dist/
```
