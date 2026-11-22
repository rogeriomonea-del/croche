# Validação do Crochet Victorioso

A interface guarda uma matriz booleana de desvios; cor, pontos altos, conflitos e instruções
continuam derivados pelas funções existentes em `src/core/`. Um arrasto é uma única ação de
desfazer. Os testes golden do crochê permanecem a referência do domínio.

## Verificações reproduzíveis

```sh
npm ci
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Quando o Chromium do sistema estiver disponível:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
```

Os testes de navegador usam o build de produção, inclusive a CSP real, e iniciam um servidor
em `http://127.0.0.1:3173`. Criam contas descartáveis e um banco SQLite isolado em
`.scratch/e2e-<timestamp>.db`. O teste de login por nome usa `user:alias` no mesmo banco de testes.
A variável `PLAYWRIGHT_DATABASE_PATH` comunica esse caminho entre a configuração e o teste.
Os cenários que não testam autenticação reutilizam uma sessão descartável; uma sessão expirada
ou encerrada é substituída. Isso evita uma rajada de cadastros sem desabilitar o limite de requisições
de produção. Não usam a conta solicitada pelo usuário, sua senha ou o banco do ateliê.

O servidor encerra ao fim da execução. Os bancos e relatórios ficam em `.scratch/` para inspeção
e podem ser removidos depois. `e2e/fixtures/woven-study.png` é uma imagem sintética determinística
com áreas claras e escuras e textura de fios; sua decodificação real é exercitada no navegador.

## Cobertura no navegador

- Identidade Crochet Victorioso na entrada; cadastro e login pelo formulário, incluindo nome de
  usuário atribuído pela CLI e normalização de maiúsculas/espaços.
- Dois cliques alternam um único desvio; X deriva na linha acima, sem ciclo de três estados.
- Linhas travadas mostram o motivo e recusam alterações nas duas visualizações.
- Pintura contínua, apagar, desfazer/refazer por gesto, zoom com roda e movimento com Espaço.
- Arrasto logo após importar: a animação de layout não desloca as células sob o cursor durante a pintura.
- Salvar pela API, recarregar, reabrir e resolver `409 revision_conflict` com “Carregar versão atual”.
- Importação/exportação JSON, paletas e redimensionamento preservam o desenho; JSON inválido é recusado.
- Expiração da sessão preserva o desenho e impede atalhos no diálogo de alterar o editor ao fundo.
- Abrir outro documento, mesmo com dimensões iguais, encerra o gesto de pintura anterior.
- Edição de 119 × 120 células com movimento reduzido.
- Galeria com exatamente 20 modelos distintos, cinco em cada categoria, busca sem acentos,
  estado vazio e aplicação de um documento com pontos válidos.
- Cancelar a substituição por modelo ou foto preserva o desenho sem salvar. Os diálogos contêm
  o foco, respondem a Escape e devolvem o foco ao botão que os abriu; Ctrl+Z não altera a criação atrás.
- Conversão de PNG real: dimensões e pixels da foto original, prévia, tamanho da grade,
  inversão reversível, recorte, contraste manual/automático e receita por carreira.
- Export da conversão: matriz binária, base/topo protegidos, X derivado, zero conflitos e
  instruções cuja soma de pontos corresponde à largura em todas as carreiras.
- Arquivo falso com extensão PNG é recusado; uma imagem válida posterior recupera a interface.
- Nenhuma requisição de rede durante a conversão da imagem. A decodificação, análise e prévia
  acontecem no dispositivo, sob a CSP real de produção.
- Largura móvel de 390 px: entrada, estúdio, galeria e conversor contidos sem rolagem horizontal.
- Nenhum erro de execução JavaScript ou violação de CSP nas telas exercitadas.

## Limites da conversão

A ferramenta aproxima a aparência de uma foto em **mosaico de duas cores**, com pontos baixos e
pontos altos sobrepostos válidos. Não recupera a receita original de uma peça tridimensional,
modelagem, tensão, medida da agulha ou pontos escondidos. A própria interface explica essa
limitação antes da aplicação e apresenta quantas células precisaram ser adaptadas às regras.

Os testes cobrem a transformação e a integridade do documento; a fidelidade visual depende de
boa iluminação, enquadramento, contraste e resolução escolhida. Uma amostra física continua
sendo necessária antes de reproduzir uma peça.

## Artefatos e resultado

As capturas ilustrativas ficam em `.scratch/playwright/screenshots/`. A variável opcional
`PLAYWRIGHT_ARTIFACT_DIR` pode direcioná-las a outra pasta. Falhas também geram screenshots e traces
em `.scratch/playwright/results/`.

Os testes de navegador não substituem `npm test`, que verifica regras de crochê, autenticação,
segurança, persistência, contratos e transformações do documento. O build deve ser gerado novamente
antes dos cenários de navegador quando algum arquivo da aplicação for alterado.

### Resultado desta entrega

`npm run build` passou para a SPA e o servidor. Os **15 cenários de navegador passaram** no
Chromium do sistema contra esse build final de produção, em aproximadamente um minuto.
A execução não registrou erros de JavaScript nem violações de CSP. A foto de teste foi decodificada
com os pixels e dimensões esperados, convertida sem requisições HTTP e exportada com instruções
válidas e sem conflitos.

Foram inspecionadas as capturas de acesso, estúdio, galeria e conversor, incluindo as versões de
390 px. Os diálogos móveis rolam verticalmente dentro da tela, sem ultrapassar sua largura.
Firefox e Safari não foram executados.
