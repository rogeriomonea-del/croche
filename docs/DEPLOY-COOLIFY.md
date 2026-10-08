# Deploy no Coolify (VPS Hostinger)

Seu VPS (`srv1842462`, KVM 8, IP `82.112.244.246`) roda **Ubuntu 24.04 com Coolify**. O Coolify já
ocupa as portas 80/443 com o proxy dele (Traefik) e emite os certificados HTTPS sozinho. Por isso,
**não** use o Caddy nem o nginx deste repositório aqui: o Coolify constrói o `Dockerfile` do repo e
coloca o app atrás do Traefik, ao lado do n8n e da calculadora que já estão lá.

O DNS já está pronto: `crochetvictorioso.com.br` → `82.112.244.246` (registro A) e
`www.crochetvictorioso.com.br` → apelido (CNAME) do domínio principal. Sem registro AAAA de propósito:
via IPv6 o Docker esconderia o IP real dos visitantes e todos dividiriam o mesmo limite de tentativas.

## 1. Criar o app (uma vez, ~5 minutos)

1. Abra o painel do Coolify (o endereço que você usa para o n8n; provavelmente
   `https://celestiaflights.cloud`).
2. **Projects** → escolha um projeto (ou **+ Add** para criar "Crochet Victorioso") → ambiente
   **production** → **+ New** / **+ Add Resource** → **Public Repository**.
3. **Repository URL**: `https://github.com/rogeriomonea-del/croche` → **Check repository**.
4. **Branch**: `claude/charming-edison-35adqg` (depois que o PR for mergeado, troque para `main`).
5. **Build Pack**: **Dockerfile** (não Nixpacks). **Base Directory**: `/`. → **Continue**.
6. Na aba **General**:
   - **Domains**: `https://crochetvictorioso.com.br,https://www.crochetvictorioso.com.br`
   - **Direction** (redirecionamento www): **Redirect to non-www**. Isso é obrigatório: o servidor
     só aceita formulários vindos de `PUBLIC_ORIGIN`, e pelo `www` o login responderia
     `403 bad_origin`.
   - **Ports Exposes**: `3000`
   - **Save**.
7. Aba **Environment Variables** → adicione (marque *Is Build Variable?* = **não** em todas):

   | Nome | Valor |
   |---|---|
   | `PUBLIC_ORIGIN` | `https://crochetvictorioso.com.br` |
   | `COOKIE_SECURE` | `true` |
   | `TRUST_PROXY` | `1` |
   | `ALLOW_SIGNUP` | `false` |
   | `LOG_LEVEL` | `info` |

   `NODE_ENV`, `HOST`, `PORT`, `DATABASE_PATH` e `STATIC_DIR` já vêm certos do `Dockerfile`; não
   os defina aqui (um valor vazio sobrescreveria o do Dockerfile e quebraria o container).
8. Aba **Persistent Storage** (ou **Storages**) → **+ Add** → **Volume**:
   - **Name**: `crochet-victorioso-data`
   - **Destination Path**: `/data`

   Sem isso o banco SQLite some a cada novo deploy.
9. (Opcional) Aba **Healthcheck**: habilite com path `/api/health` e porta `3000`. O `Dockerfile` já
   declara um `HEALTHCHECK` equivalente.
10. Clique em **Deploy** e acompanhe os logs. O primeiro build leva alguns minutos (`npm ci` +
    build da SPA e do servidor). O Coolify pede o certificado do Let's Encrypt sozinho.

Confira: `https://crochetvictorioso.com.br/api/health` deve responder `{"ok":true}` e a página
inicial deve mostrar a tela de entrada do Crochet Victorioso.

## 2. Criar sua conta

Com o cadastro público desligado, a conta é criada pelo terminal do container. No Coolify, abra o
app → aba **Terminal** → escolha o container do app → **Connect** e rode:

```sh
node dist-server/cli.js user:create voce@exemplo.com
```

Ele pede a senha duas vezes (mínimo de 10 caracteres; não aparece enquanto você digita). Para entrar
com um nome em vez do e-mail:

```sh
node dist-server/cli.js user:alias voce@exemplo.com "Seu Nome"
```

Outros comandos: `user:list`, `user:set-password <email>`, `user:delete <email>`,
`db:backup <arquivo>`. Para abrir o cadastro ao público, mude `ALLOW_SIGNUP` para `true` e faça
**Redeploy**.

## 3. Atualizações

Cada **Deploy**/**Redeploy** no Coolify baixa o branch, reconstrói a imagem e troca o container.
As migrações do banco rodam sozinhas na subida; os dados ficam no volume `/data`. Para deploy
automático a cada push, ative **Auto Deploy** (precisa do webhook do GitHub configurado no Coolify).

## 4. Backups

- O VPS tem o backup semanal da Hostinger (hPanel → VPS → Backups).
- Cópia consistente do banco, pelo terminal do container:

  ```sh
  node dist-server/cli.js db:backup /data/backup-$(date +%F).db
  ```

  Ela fica no mesmo volume; baixe-a pelo terminal do Coolify ou copie para fora do VPS. Também dá
  para agendar o mesmo comando em **Scheduled Tasks** do app no Coolify (por exemplo `0 3 * * *`).
  O comando recusa sobrescrever um arquivo que já existe.

## 5. Problemas comuns

| Sintoma | Causa provável |
|---|---|
| Login responde `403 bad_origin` | Entrou pelo `www` sem o redirecionamento, ou `PUBLIC_ORIGIN` diferente do endereço no navegador |
| Login "funciona" mas volta para a tela de entrada | `COOKIE_SECURE=true` sem HTTPS (certificado ainda não emitido) |
| Container reinicia com `Invalid configuration` | Variável com valor inválido; o log diz qual |
| Padrões somem após um deploy | Faltou o volume persistente em `/data` |
| Todos os usuários bloqueados juntos por "muitas tentativas" | `TRUST_PROXY` ausente: o app vê o IP do Traefik em vez do visitante |
