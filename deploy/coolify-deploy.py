#!/usr/bin/env python3
"""Create (or update) the Crochet Victorioso app in Coolify through its API and deploy it.

    COOLIFY_URL=https://coolify.example.com COOLIFY_TOKEN_FILE=/path/to/token python3 deploy/coolify-deploy.py

The token is read from a file and never printed. STEP=inspect only lists what exists.
Optional: BRANCH (default claude/charming-edison-35adqg), DOMAIN (default crochetvictorioso.com.br).
"""
import json, os, sys, time, urllib.error, urllib.request

BASE = os.environ['COOLIFY_URL'].rstrip('/') + '/api/v1'
TOKEN = open(os.environ['COOLIFY_TOKEN_FILE']).read().strip()
REPO = 'https://github.com/rogeriomonea-del/croche'
BRANCH = os.environ.get('BRANCH', 'claude/charming-edison-35adqg')
DOMAIN = os.environ.get('DOMAIN', 'crochetvictorioso.com.br')
NAME = 'crochet-victorioso'
VOLUME = 'crochet-victorioso-data'
ENVS = {'PUBLIC_ORIGIN': f'https://{DOMAIN}', 'COOKIE_SECURE': 'true', 'TRUST_PROXY': '1',
        'ALLOW_SIGNUP': 'false', 'LOG_LEVEL': 'info'}


def api(method, path, body=None, allow=()):
    req = urllib.request.Request(
        BASE + path, method=method, data=None if body is None else json.dumps(body).encode(),
        headers={'Authorization': f'Bearer {TOKEN}', 'Accept': 'application/json', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            raw = res.read().decode()
            return res.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as err:
        raw = err.read().decode()
        if err.code in allow:
            return err.code, raw
        sys.exit(f'{method} {path} -> HTTP {err.code}: {raw[:800]}')


_, version = api('GET', '/version')
print('coolify version:', version)
_, servers = api('GET', '/servers')
print('servers:', [(s.get('name'), s.get('uuid'), s.get('ip')) for s in servers])
_, projects = api('GET', '/projects')
print('projects:', [(p.get('name'), p.get('uuid')) for p in projects])
_, apps = api('GET', '/applications')
print('applications:', [(a.get('name'), a.get('fqdn'), a.get('status')) for a in apps])
if os.environ.get('STEP') == 'inspect':
    sys.exit(0)

mine = [a for a in apps if a.get('name') == NAME]
if mine:
    app_uuid = mine[0]['uuid']
    print('updating existing app', app_uuid)
else:
    server = next((s for s in servers if s.get('name') == 'localhost'), servers[0])
    project = next((p for p in projects if p.get('name') == 'Crochet Victorioso'), None)
    if not project:
        _, project = api('POST', '/projects', {'name': 'Crochet Victorioso', 'description': 'Ateliê de crochê em mosaico'})
    _, created = api('POST', '/applications/public', {
        'project_uuid': project['uuid'], 'server_uuid': server['uuid'], 'environment_name': 'production',
        'git_repository': REPO, 'git_branch': BRANCH, 'build_pack': 'dockerfile', 'ports_exposes': '3000',
        'name': NAME, 'description': 'Crochet Victorioso (SPA + API + SQLite)',
        'domains': f'https://{DOMAIN},https://www.{DOMAIN}', 'redirect': 'non-www',
        'is_force_https_enabled': True, 'is_auto_deploy_enabled': False,
        'health_check_enabled': True, 'health_check_path': '/api/health', 'health_check_port': '3000',
        'instant_deploy': False,
    })
    app_uuid = created['uuid']
    print('created app', app_uuid)

api('PATCH', f'/applications/{app_uuid}/envs/bulk', {'data': [
    {'key': k, 'value': v, 'is_preview': False, 'is_literal': True} for k, v in ENVS.items()]})
print('environment variables set:', ', '.join(sorted(ENVS)))

status, storages = api('GET', f'/applications/{app_uuid}/storages', allow=(404, 405))
if status in (404, 405):
    # Older Coolify without the storages API: mount the named volume through docker run options.
    api('PATCH', f'/applications/{app_uuid}', {'custom_docker_run_options': f'-v {VOLUME}:/data'})
    print(f'volume {VOLUME} -> /data via custom docker options')
elif not any(s.get('mount_path') == '/data' for s in (storages or {}).get('persistent_storages', [])):
    api('POST', f'/applications/{app_uuid}/storages', {'type': 'persistent', 'name': VOLUME, 'mount_path': '/data'})
    print(f'volume {VOLUME} -> /data created')
else:
    print('volume /data already present')

status, started = api('POST', f'/applications/{app_uuid}/start?force=true', allow=(404, 405))
if status in (404, 405):
    _, started = api('GET', f'/applications/{app_uuid}/start?force=true')
deployment = started.get('deployment_uuid')
print('deployment queued:', deployment)
for i in range(1, 91):
    time.sleep(20)
    _, dep = api('GET', f'/deployments/{deployment}')
    state = dep.get('status')
    print(f'[{i * 20}s] {state}', flush=True)
    if state in ('finished', 'failed', 'cancelled-by-user', 'error'):
        if state != 'finished':
            logs = dep.get('logs')
            try:
                for entry in (json.loads(logs) if isinstance(logs, str) else logs or [])[-60:]:
                    print('   ', (entry.get('output') or '')[:300])
            except (ValueError, AttributeError):
                print(str(logs)[-6000:])
            sys.exit(1)
        break
_, app = api('GET', f'/applications/{app_uuid}')
print('app status:', app.get('status'), '| fqdn:', app.get('fqdn'))
