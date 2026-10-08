# Deploy no VPS

Um único processo Node serve a API (`/api`) e a SPA já buildada. Os dados ficam num arquivo SQLite.
Na frente dele fica um proxy reverso com HTTPS (Caddy ou nginx); o app em si nunca fica exposto
direto na internet.

Há dois caminhos. Escolha **um**:

- **A — Docker Compose** (recomendado): tudo em containers; o Caddy opcional cuida do HTTPS sozinho.
- **B — Node + systemd + nginx**: sem Docker, com o certificado emitido pelo certbot.

Nos exemplos, troque `mosaic.example.com` pelo seu domínio e `voce@exemplo.com` pelo seu e-mail.

## Sumário

1. [Requisitos](#1-requisitos)
2. [Caminho A — Docker Compose (+ Caddy)](#2-caminho-a--docker-compose--caddy)
3. [Caminho B — Node + systemd + nginx](#3-caminho-b--node--systemd--nginx)
4. [Primeiro usuário](#4-primeiro-usuário)
5. [Cadastro público: ligar e desligar](#5-cadastro-público-ligar-e-desligar)
6. [Backups](#6-backups)
7. [Atualizações](#7-atualizações)
8. [PUBLIC_ORIGIN, COOKIE_SECURE e TRUST_PROXY](#8-public_origin-cookie_secure-e-trust_proxy)
9. [Todas as variáveis](#9-todas-as-variáveis)
10. [Solução de problemas](#10-solução-de-problemas)

## 1. Requisitos

- VPS Linux com Debian 12 ou Ubuntu 22.04+ (x86-64 ou ARM64). 1 vCPU e 1 GB de RAM bastam.
- Um domínio (ou subdomínio) com registro DNS `A` (e `AAAA`, se houver IPv6) apontando para o VPS.
  O Caddy do caminho A roda na rede do host justamente para ver o IPv6 real de cada visitante
  ([seção 8](#8-public_origin-cookie_secure-e-trust_proxy)).
- Portas 80 e 443 liberadas no firewall do provedor e no do servidor, por exemplo:
  ```sh
  sudo ufw allow OpenSSH
  sudo ufw allow 80,443/tcp
  sudo ufw enable
  ```
- Caminho A: [Docker Engine com o plugin compose](https://docs.docker.com/engine/install/)
  (`docker compose version` precisa funcionar).
- Caminho B: Node.js 22, nginx, certbot e git.
- O repositório é `https://github.com/rogeriomonea-del/croche`. Se ele for privado, o VPS precisa de
  acesso (deploy key ou token do GitHub) para o `git clone` e o `git pull`.

## 2. Caminho A — Docker Compose (+ Caddy)

A imagem roda como o usuário `node` (uid 1000), escuta na porta 3000 dentro do container e guarda o
banco em `/data/mosaic.db`, que é a pasta `./data` do projeto no host. O compose publica a porta só
em `127.0.0.1:3000`: de fora, o acesso é pelo Caddy, que roda na rede do host (portas 80/443 do VPS)
e repassa para esse endereço.

Os comandos `docker` abaixo precisam de `sudo` se o seu usuário não estiver no grupo `docker`.

1. **Baixe o código.**
   ```sh
   sudo mkdir -p /srv/mosaic-crochet
   sudo chown "$(id -un)": /srv/mosaic-crochet
   git clone https://github.com/rogeriomonea-del/croche.git /srv/mosaic-crochet
   cd /srv/mosaic-crochet
   ```
2. **Configure.** Copie o exemplo e ajuste pelo menos `PUBLIC_ORIGIN`:
   ```sh
   cp .env.example .env
   nano .env
   ```
   ```ini
   PUBLIC_ORIGIN=https://mosaic.example.com
   TRUST_PROXY=1
   ```
   Deixe `HOST`, `PORT`, `DATABASE_PATH` e `STATIC_DIR` comentadas: a imagem já define os valores
   certos para o container, e o `.env` passaria por cima deles.
3. **Crie a pasta de dados com o dono certo.** Sem isso o app não consegue criar o banco. O modo
   700 impede que outras contas do VPS leiam o banco e os backups (e-mails e hashes de senha).
   ```sh
   sudo install -d -m 700 -o 1000 -g 1000 data
   ```
   Se a pasta já existe, `sudo chown 1000:1000 data && sudo chmod 700 data`. No host, o dono é
   quem tiver o uid 1000; no Ubuntu costuma ser o primeiro usuário criado, que assim também lê o
   banco. Se isso não serve, não crie contas com esse uid no VPS.
4. **Não edite o `deploy/Caddyfile`.** O Caddy usa como endereço do site o `PUBLIC_ORIGIN` do
   `.env` (o compose repassa a variável), então o certificado sai para o mesmo domínio que o app
   aceita. Editar o arquivo faria o `git pull` das atualizações falhar.
5. **Suba o app e o Caddy.** O primeiro build leva alguns minutos.
   ```sh
   docker compose --profile caddy up -d --build
   ```
6. **Confira.**
   ```sh
   docker compose --profile caddy ps                # app "healthy", caddy "running"
   curl -s http://127.0.0.1:3000/api/health         # {"ok":true}
   docker compose logs -f app                       # Ctrl+C para sair
   ```
   Abra `https://mosaic.example.com`. O Caddy emite o certificado ao iniciar (leva alguns
   segundos); se ele falhar, veja `docker compose logs caddy`.
7. Crie a sua conta: [seção 4](#4-primeiro-usuário).

**Sem Caddy** (o VPS já tem um nginx atendendo outros sites): suba só o app com
`docker compose up -d --build` e configure o nginx do host como no
[passo 4 do caminho B](#nginx-e-certificado). O `proxy_pass` para `127.0.0.1:3000` é o mesmo.

## 3. Caminho B — Node + systemd + nginx

O código fica em `/opt/mosaic-crochet` (seu usuário é o dono e faz os builds), o serviço roda como
um usuário de sistema `mosaic` que só lê o código, e o banco fica em `/var/lib/mosaic-crochet`
(o systemd cria a pasta). O app escuta só em `127.0.0.1:3000`; o nginx faz o HTTPS.

1. **Instale Node 22, nginx e certbot.** (NodeSource instala o Node em `/usr/bin/node`, o caminho
   que o serviço usa.)
   ```sh
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
   sudo apt-get install -y nodejs nginx certbot python3-certbot-nginx git
   node --version                                    # v22.x
   ```
2. **Crie o usuário do serviço, baixe e builde o código.**
   ```sh
   sudo useradd --system --no-create-home --shell /usr/sbin/nologin mosaic
   sudo mkdir -p /opt/mosaic-crochet
   sudo chown "$(id -un)": /opt/mosaic-crochet
   git clone https://github.com/rogeriomonea-del/croche.git /opt/mosaic-crochet
   cd /opt/mosaic-crochet
   npm ci && npm run build && npm prune --omit=dev
   ```
3. **Configure e ligue o serviço.**
   ```sh
   sudo install -m 640 -o root -g mosaic .env.example /etc/mosaic-crochet.env
   sudoedit /etc/mosaic-crochet.env
   ```
   Ajuste `PUBLIC_ORIGIN` e **descomente** `DATABASE_PATH`: o serviço só pode escrever em
   `/var/lib/mosaic-crochet`, e o padrão (`./data`, dentro do código) é somente leitura para ele.
   `HOST=127.0.0.1` já é o padrão; descomentar só deixa isso explícito.
   ```ini
   PUBLIC_ORIGIN=https://mosaic.example.com
   TRUST_PROXY=1
   HOST=127.0.0.1
   DATABASE_PATH=/var/lib/mosaic-crochet/mosaic.db
   ```
   ```sh
   sudo cp deploy/mosaic-crochet.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now mosaic-crochet
   systemctl status mosaic-crochet
   curl -s http://127.0.0.1:3000/api/health          # {"ok":true}
   journalctl -u mosaic-crochet -f                   # logs; Ctrl+C para sair
   ```
4. <a id="nginx-e-certificado"></a>**nginx e certificado.** Emita o certificado **antes** de ativar o
   site (o bloco 443 do exemplo aponta para os arquivos do certificado). O plugin nginx do certbot
   responde ao desafio sozinho; o `--deploy-hook` recarrega o nginx a cada renovação automática.
   ```sh
   sudo certbot certonly --nginx -d mosaic.example.com --deploy-hook 'systemctl reload nginx'
   sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/mosaic-crochet
   sudo sed -i 's/mosaic\.example\.com/SEU-DOMINIO/g' /etc/nginx/sites-available/mosaic-crochet
   sudo ln -s /etc/nginx/sites-available/mosaic-crochet /etc/nginx/sites-enabled/mosaic-crochet
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot renew --dry-run                      # testa a renovação
   ```
5. Crie a sua conta: [seção 4](#4-primeiro-usuário).

## 4. Primeiro usuário

O cadastro público vem desligado (`ALLOW_SIGNUP=false`), então a primeira conta (e qualquer outra,
se o cadastro continuar desligado) é criada pela CLI. Ela pede a senha duas vezes, sem mostrá-la
(mínimo de 10 caracteres).

**Caminho A (Docker):**
```sh
cd /srv/mosaic-crochet
docker compose exec app node dist-server/cli.js user:create voce@exemplo.com
```

**Caminho B (systemd):** a CLI precisa rodar como `mosaic` e com o mesmo env do serviço. Crie um
atalho uma vez (cole no `~/.bashrc` para ficar permanente):
```sh
mosaic-cli() {
  (cd /opt/mosaic-crochet && sudo -u mosaic sh -c 'set -a; . /etc/mosaic-crochet.env; exec node dist-server/cli.js "$@"' mosaic-cli "$@")
}
mosaic-cli user:create voce@exemplo.com
```

Outros comandos (troque o começo do comando conforme o caminho):

| Comando | O que faz |
|---|---|
| `user:list` | lista as contas |
| `user:set-password voce@exemplo.com` | troca a senha e encerra as sessões abertas dessa conta |
| `user:delete voce@exemplo.com` | apaga a conta, as sessões e os padrões dela |
| `db:backup <arquivo>` | cópia consistente do banco ([seção 6](#6-backups)) |
| `db:migrate` | aplica migrações pendentes (o app já faz isso ao iniciar) |

Para automatizar sem terminal, passe a senha pela entrada padrão com `--password-stdin` (no Docker,
use `exec -T`). Cuidado: a senha não pode ficar no histórico do shell.
```sh
docker compose exec -T app node dist-server/cli.js user:create voce@exemplo.com --password-stdin < arquivo-com-a-senha
```

## 5. Cadastro público: ligar e desligar

Com `ALLOW_SIGNUP=true`, a tela de login mostra a opção de criar conta e qualquer pessoa com o link
pode se cadastrar. Com `false` (padrão), só a CLI cria contas; quem já tem conta continua entrando.

**Caminho A:** edite `ALLOW_SIGNUP` no `.env` e recrie o container. `docker compose restart` **não**
relê o `.env`; use `up -d`:
```sh
docker compose up -d
```
**Caminho B:** edite `/etc/mosaic-crochet.env` e reinicie:
```sh
sudo systemctl restart mosaic-crochet
```

## 6. Backups

`db:backup` usa o backup online do SQLite: gera uma cópia consistente com o app rodando, sem parar
nada. O comando se recusa a sobrescrever um arquivo que já existe, então use nomes com data.

**Backup manual:**
```sh
# A (Docker): o arquivo aparece em /srv/mosaic-crochet/data/backups/
docker compose exec -T app node dist-server/cli.js db:backup /data/backups/mosaic-$(date +%F).db
# B (systemd)
mosaic-cli db:backup /var/lib/mosaic-crochet/backups/mosaic-$(date +%F).db
```

**Backup diário com cron** (`sudo crontab -e`; no crontab o `%` precisa ser escrito `\%`). Às 3h15
faz o backup e às 3h30 apaga os com mais de 14 dias:
```cron
# Caminho A
15 3 * * * cd /srv/mosaic-crochet && docker compose exec -T app node dist-server/cli.js db:backup /data/backups/mosaic-$(date +\%F).db 2>&1 | logger -t mosaic-backup
30 3 * * * find /srv/mosaic-crochet/data/backups -name 'mosaic-*.db' -mtime +14 -delete

# Caminho B
15 3 * * * cd /opt/mosaic-crochet && sudo -u mosaic sh -c 'set -a; . /etc/mosaic-crochet.env; exec node dist-server/cli.js db:backup /var/lib/mosaic-crochet/backups/mosaic-$(date +\%F).db' 2>&1 | logger -t mosaic-backup
30 3 * * * find /var/lib/mosaic-crochet/backups -name 'mosaic-*.db' -mtime +14 -delete
```
O resultado aparece em `journalctl -t mosaic-backup`. Um backup que fica só no próprio VPS some
junto com ele: copie a pasta de backups para outro lugar (outra máquina com `rsync`, ou um storage
com `rclone`).

**Restaurar** (o app fica fora do ar por alguns segundos). Os arquivos atuais vão para uma pasta à
parte, em vez de serem apagados; `mosaic.db-wal` e `mosaic.db-shm` precisam sair junto, senão o
SQLite misturaria o diário antigo com o banco restaurado.
```sh
# A (Docker)
cd /srv/mosaic-crochet
docker compose stop app
sudo mkdir -p data/antes-da-restauracao
sudo mv data/mosaic.db* data/antes-da-restauracao/
sudo cp data/backups/mosaic-2026-10-08.db data/mosaic.db
sudo chown 1000:1000 data/mosaic.db
docker compose start app

# B (systemd)
sudo systemctl stop mosaic-crochet
sudo mkdir -p /var/lib/mosaic-crochet/antes-da-restauracao
sudo sh -c 'mv /var/lib/mosaic-crochet/mosaic.db* /var/lib/mosaic-crochet/antes-da-restauracao/'
sudo cp /var/lib/mosaic-crochet/backups/mosaic-2026-10-08.db /var/lib/mosaic-crochet/mosaic.db
sudo chown mosaic:mosaic /var/lib/mosaic-crochet/mosaic.db
sudo systemctl start mosaic-crochet
```
Se o backup for de uma versão mais antiga do app, as migrações rodam sozinhas ao iniciar.

## 7. Atualizações

As migrações do banco rodam sozinhas quando o app inicia. Faça um backup antes: se você precisar
voltar para a versão anterior do código depois de uma migração, o app antigo se recusa a abrir um
banco mais novo, e aí é preciso restaurar esse backup.

**Caminho A:** se você editou o `deploy/Caddyfile` seguindo uma versão antiga deste guia, desfaça
antes com `git checkout deploy/Caddyfile` (o domínio agora vem do `PUBLIC_ORIGIN`), senão o
`git pull` para com `Your local changes ... would be overwritten`.
```sh
cd /srv/mosaic-crochet
docker compose exec -T app node dist-server/cli.js db:backup /data/backups/antes-de-atualizar-$(date +%F-%H%M).db
git pull
docker compose --profile caddy up -d --build      # sem Caddy: docker compose up -d --build
docker image prune -f                             # remove as imagens antigas
```

**Caminho B:**
```sh
cd /opt/mosaic-crochet
mosaic-cli db:backup /var/lib/mosaic-crochet/backups/antes-de-atualizar-$(date +%F-%H%M).db
git pull
npm ci && npm run build && npm prune --omit=dev
sudo systemctl restart mosaic-crochet
```

## 8. PUBLIC_ORIGIN, COOKIE_SECURE e TRUST_PROXY

As três precisam combinar com o jeito como o site é acessado. A maioria dos problemas de deploy
vem daqui.

**`PUBLIC_ORIGIN`** é o endereço exato que aparece na barra do navegador: esquema + domínio (+ porta,
se não for a padrão), sem caminho. Exemplo: `https://mosaic.example.com`. Toda requisição que altera
dados (login, salvar, apagar) com um cabeçalho `Origin` diferente desse valor recebe
`403 bad_origin`, o que protege as contas contra outros sites. `https://www.mosaic.example.com`,
`http://mosaic.example.com` e `https://mosaic.example.com:8443` são origens **diferentes**; se o site
responde em mais de um endereço, redirecione os outros para o principal. É obrigatório com
`NODE_ENV=production`.

**`COOKIE_SECURE`** (padrão `true` em produção) marca o cookie de sessão como `Secure` e usa o nome
`__Host-mosaic_session`; o navegador só guarda esse cookie em HTTPS. Mantenha `true` com Caddy ou
nginx+certbot. Só use `false` num teste sem HTTPS, e nunca num site público.

**`TRUST_PROXY`** diz ao app em quem confiar para descobrir o IP do visitante. Os limites de
requisição (300/min por IP, 10 logins/min por IP) dependem disso. Atrás do proxy, sem essa
variável, todos os visitantes parecem vir do mesmo IP (o do proxy) e dividem o mesmo limite: um
visitante ativo bloqueia os outros com `429 rate_limited`.

| Como o app está exposto | Valor |
|---|---|
| Docker + Caddy (`--profile caddy`) | `TRUST_PROXY=1` |
| Docker + nginx do host | `TRUST_PROXY=1` |
| systemd + nginx | `TRUST_PROXY=1` (ou `TRUST_PROXY=127.0.0.1`, que é mais restrito) |
| Sem proxy (não recomendado) | `TRUST_PROXY=false` |

`1` significa "confie só no proxy imediatamente à frente": o app usa o IP que o Caddy ou o nginx
informam em `X-Forwarded-For`, e ignora qualquer coisa que o visitante tenha escrito nesse
cabeçalho. Isso só é seguro porque o app não é acessível de fora sem passar pelo proxy (o Docker
publica a porta só em `127.0.0.1`; no systemd, `HOST=127.0.0.1`). Não use `true`: ele confia na
cadeia inteira de `X-Forwarded-For`, inclusive no que o próprio visitante escreve.

Para conferir: os logs do app mostram `remoteAddress` em cada requisição; com `TRUST_PROXY` certo,
aparece o IP de quem acessou, e não o do proxy (`172.x.x.x` no Docker, `127.0.0.1` no systemd).
Visitantes por IPv6 também aparecem com o próprio IP: por isso o Caddy do compose usa
`network_mode: host`. Com portas publicadas na rede padrão do Docker (só IPv4), quem chega por IPv6
entraria com o IP do gateway (`172.x.0.1`), e todos os visitantes IPv6 dividiriam um único limite.

## 9. Todas as variáveis

Validadas ao iniciar: um valor inválido derruba o processo com uma mensagem que diz qual variável
corrigir. Vazio (`NOME=`) vale o padrão.

| Variável | Padrão | Na imagem Docker | Para que serve |
|---|---|---|---|
| `NODE_ENV` | `development` | `production` | `production` exige `PUBLIC_ORIGIN` e liga `COOKIE_SECURE` |
| `HOST` | `127.0.0.1` | `0.0.0.0` | interface de escuta |
| `PORT` | `3000` | `3000` | porta HTTP do app |
| `DATABASE_PATH` | `./data/mosaic.db` | `/data/mosaic.db` | arquivo SQLite |
| `PUBLIC_ORIGIN` | `http://localhost:5173` | (defina no `.env`) | origem pública exata ([seção 8](#8-public_origin-cookie_secure-e-trust_proxy)) |
| `ALLOW_SIGNUP` | `false` | | cadastro público ([seção 5](#5-cadastro-público-ligar-e-desligar)) |
| `COOKIE_SECURE` | `true` em produção | | cookie de sessão só em HTTPS |
| `TRUST_PROXY` | `false` | | `true`, `false`, nº de proxies ou lista de IPs/CIDRs separados por vírgula |
| `SESSION_TTL_DAYS` | `30` | | dias de validade da sessão, renovada a cada uso |
| `MAX_PATTERNS_PER_USER` | `500` | | máximo de padrões por conta |
| `STATIC_DIR` | `./dist` | `/app/dist` | pasta da SPA buildada |
| `LOG_LEVEL` | `info` | | `fatal`, `error`, `warn`, `info`, `debug`, `trace` ou `silent` |

## 10. Solução de problemas

Logs: `docker compose logs -f app` (A) ou `journalctl -u mosaic-crochet -f` (B).

| Sintoma | Causa provável e solução |
|---|---|
| O app não sobe; o log diz `Invalid configuration:` | A mensagem lista cada variável inválida. Corrija o env e suba de novo (A: `docker compose up -d`; B: `sudo systemctl restart mosaic-crochet`). |
| `403 bad_origin` ao entrar ou salvar (o site abre normalmente) | `PUBLIC_ORIGIN` diferente do endereço na barra do navegador: confira esquema, `www` e porta ([seção 8](#8-public_origin-cookie_secure-e-trust_proxy)). |
| O login "funciona", mas ao recarregar a página você volta para a tela de login | O navegador não guardou o cookie: `COOKIE_SECURE=true` com o site em `http://`. Acesse por HTTPS (Caddy ou nginx+certbot). |
| `429 rate_limited` para todo mundo ao mesmo tempo | Proxy na frente sem `TRUST_PROXY=1`: todos dividem o limite do IP do proxy. |
| A (Docker): `unable to open database file` ou `EACCES` em `/data` | A pasta `./data` não pertence ao uid 1000: `sudo chown -R 1000:1000 data`. |
| B (systemd): `read-only file system` ao abrir o banco | `DATABASE_PATH` fora de `/var/lib/mosaic-crochet`; o serviço só escreve lá. |
| Mudou o `.env` e nada aconteceu | `docker compose restart` não relê o `.env`; use `docker compose up -d`. |
| O Caddy não consegue o certificado | DNS ainda não aponta para o VPS, portas 80/443 fechadas ou domínio errado no `PUBLIC_ORIGIN` do `.env` (o Caddy usa o mesmo endereço). Veja `docker compose logs caddy`. |
| nginx responde `502 Bad Gateway` | O app não está rodando ou não está na porta 3000: `systemctl status mosaic-crochet` ou `docker compose ps`. |
| `Database schema version N is newer than this build supports` | O código voltou para uma versão anterior depois de uma migração. Volte para a versão nova ou restaure o backup feito antes de atualizar. |
