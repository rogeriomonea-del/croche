# Crochet Victorioso

Um ateliê digital para desenhar padrões de **overlay mosaic crochet**, com texturas de linho,
tons de ameixa e dourado, simulação de fios, contas e biblioteca no seu próprio servidor.

## Modelos e fotografias

A galeria traz **20 modelos originais** prontos para editar, em quatro coleções: Geometria,
Botânica, Afeto e Paisagens e bordas. Pesquise pelo nome, escolha um motivo e personalize fios,
dimensões e pontos. Aplicar um modelo pede confirmação quando há alterações não salvas.

Em **Converter foto em pontos**, escolha uma imagem PNG, JPEG ou WebP de até 12 MB e
24 megapixels. A fotografia é processada localmente no navegador, sem envio a serviços externos.
Ajuste o enquadramento, a quantidade de carreiras e pontos, o contraste e a inversão de cores;
a prévia e as instruções acompanham os ajustes. Depois, use **Usar este mosaico** para editar,
salvar ou exportar o desenho no estúdio.

A conversão produz uma **aproximação editável em duas cores**. Ela não identifica a receita
exata de uma peça tridimensional, sua modelagem ou pontos escondidos. Fotos frontais, com boa
luz, fundo simples e motivos de alto contraste funcionam melhor. O conversor adapta as células
às regras do mosaico, protegendo as carreiras de borda e evitando pontos altos conflitantes;
as instruções são calculadas pelo mesmo núcleo do editor. Faça uma amostra antes de tecer.

## O estúdio

- **Simulação** troca a cor com um clique; o ponto alto correspondente é derivado na linha acima.
- **Gráfico** coloca ou remove o ponto alto, preservando o mesmo desenho e as regras do núcleo.
- Pinte arrastando, apague com a borracha e desfaça/refaça um gesto inteiro.
- Use a roda do mouse para zoom, **Espaço + arrastar** para mover e o botão de enquadrar para voltar.
- Selecione **B** para o gancho, **E** para a borracha e **H** para mover, com a bancada em foco.
- Na bancada, as setas navegam pelas células; **Enter** alterna o ponto e **Delete** apaga.
- **Ctrl/⌘ Z**, **Ctrl/⌘ Shift Z** e **Ctrl/⌘ S** desfazem, refazem e salvam.
- Escolha pares de fios, edite cores e dê nomes aos novelos. Os nomes são anotações da sessão;
  o documento e a API continuam salvando as duas cores A/B no formato original.
- Comece em branco, com um dos 20 modelos ou convertendo uma fotografia.
- Conflitos e instruções continuam sendo calculados ao vivo pelo motor original.
- Exporte CSV/JSON ou importe um documento validado; salvar continua usando a API e sua revisão.

Framer Motion anima as transições, respeitando a preferência de movimento reduzido. Fontes,
cursores e demais recursos são locais e compatíveis com a CSP de produção.

## Desenvolvimento

Requer **Node.js 22 ou superior** e npm. Em plataformas sem binário pronto do `better-sqlite3`,
a instalação também usa Python, make e um compilador C++.

```sh
npm ci
npm run dev:server   # API em 127.0.0.1:3000; banco em ./data/
```

Em outro terminal:

```sh
npm run dev          # SPA em localhost:5173; /api passa pelo proxy do Vite
```

Crie a primeira conta pelo comando interativo (cadastro público desligado por padrão):

```sh
npm run cli:dev -- user:create voce@exemplo.com
```

O comando solicita a senha sem exibi-la. Para permitir login por nome, além do e-mail:

```sh
npm run cli:dev -- user:alias voce@exemplo.com "Seu nome de acesso"
```

Nomes de acesso são únicos e não diferenciam maiúsculas de minúsculas. O cadastro público,
quando habilitado, continua usando e-mail. Em um servidor com o build pronto, use `npm run cli`
no lugar de `npm run cli:dev`.

Contas pertencem ao banco da instalação. O pacote de código não inclui banco de usuários,
senhas ou arquivos `.env`; em outra instalação, crie a conta pelos comandos acima.

## Validação e build

```sh
npm test             # regras, golden tests, API, segurança, persistência e interações puras
npm run build        # SPA em dist/ + servidor em dist-server/
npx playwright install chromium
npm run test:e2e      # navegador com servidor real e banco descartável
```

A suíte de navegador usa o build existente; execute `npm run build` após mudanças.
Instruções e cenários: [`docs/FRONTEND-VALIDATION.md`](docs/FRONTEND-VALIDATION.md).

Para testar o build localmente com HTTP:

```sh
PUBLIC_ORIGIN=http://127.0.0.1:3000 npm start
```

Para produção com HTTPS, use as configurações existentes em
[`docs/DEPLOY.md`](docs/DEPLOY.md) e [`.env.example`](.env.example). No VPS da Hostinger com
Coolify, siga [`docs/DEPLOY-COOLIFY.md`](docs/DEPLOY-COOLIFY.md).

O núcleo do crochê e seus golden tests foram preservados: cada célula guarda somente um booleano,
e suas cores e pontos altos são derivados. O formato JSON e a persistência de padrões por revisão
continuam compatíveis. O servidor ganhou suporte a nomes de login por uma migração adicional,
sem remover o acesso por e-mail. As regras estão em [`SPEC.md`](SPEC.md), e os limites do retrabalho
visual em [`docs/HANDOFF-FRONTEND.md`](docs/HANDOFF-FRONTEND.md).
