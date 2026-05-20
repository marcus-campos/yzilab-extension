# Animalex Bridge

Extensão Chrome (Manifest V3) que faz a ponte entre o YziLab/Animalex e parceiros externos —
começando pela Petlove. As chamadas à Petlove acontecem dentro do navegador do usuário, que já
está autenticado, então o Cloudflare aceita normalmente (TLS real do Chrome + cookies reais).

## Instalação em desenvolvimento

1. `chrome://extensions` → ative **Developer mode** (canto superior direito).
2. Clique em **Load unpacked** e selecione a pasta `yzilab-extension/`.
3. Fixe o ícone na barra de ferramentas.
4. Clique no ícone → abre o painel lateral à direita do Chrome.

## Configuração

Aba **Config**:
- **URL do YziLab**: produção (`https://app.animalex.com.br`) ou ambientes locais
  (`localhost:8100`, `localhost:8000`).
- **Conta**: login com email/senha do YziLab. JWT salvo em `chrome.storage.local`, com refresh
  automático.

## Uso

### Importar pedidos da Petlove

1. Faça login na Central de Saúde Petlove (`https://central-de-saude.petlove.com.br/`).
   O content script captura automaticamente o `access_token` e o `XSRF-TOKEN` ao detectar
   atividade na aba.
2. No painel, vá em **Petlove · Inbox** → **Atualizar inbox**.
3. Para cada linha, clique em **Processar**, mapeie clínica/veterinário/exames e confirme.

### Enviar laudos prontos para a Petlove

1. Vá em **Petlove · Push**.
2. A fila mostra mapeamentos onde todos os exames irmãos do mesmo pedido Petlove estão
   finalizados no YziLab. PDFs vêm pré-anexados em base64.
3. Clique em **Push** (linha) ou **Push de todos**. Cada item executa
   `accept → complete → confirm`.

## Adicionando novos módulos (futuro)

Estrutura modular já pronta. Para um novo parceiro:

1. Crie `modules/<novo>/` com pelo menos `index.js`, `api.js`, abas de UI.
2. No `index.js`, registre via:
   ```js
   import * as registry from "../../lib/module-registry.js";
   registry.register({
     id: "novo",
     label: "Novo Parceiro",
     tabs: [{ id: "inbox", label: "Inbox", mount: mountInboxTab }],
   });
   ```
3. Importe o novo `modules/<novo>/index.js` em `sidepanel/sidepanel.js`.

Se o parceiro também usa o pipeline `HealthInsurance` no backend, basta criar a `Strategy`
correspondente em `apps/health_insurance/strategies.py` (registry `STRATEGY_REGISTRY`) — os
endpoints `exam-requests-from-extension`, `result-push-queue` e `result-push-confirm` já são
genéricos por convênio.

## Backend YziLab — endpoints usados

| Método | Rota | Para quê |
|---|---|---|
| `POST` | `/api/v1/token/` | login |
| `POST` | `/api/v1/token/refresh/` | refresh JWT |
| `GET` | `/api/v1/health-insurance/` | resolve o `id` do convênio "Petlove" |
| `GET` | `/api/v1/clinic/` `/exam/` `/veterinary/` | listas para o mapeamento |
| `POST` | `/api/v1/health-insurance/{id}/exam-requests-from-extension/` | inbox (normaliza + enriquece) |
| `POST` | `/api/v1/health-insurance/{id}/exam-requests/{external_id}/process/` | cria ExamRequest |
| `GET` | `/api/v1/health-insurance/result-push-queue/` | fila com anexos em base64 |
| `POST` | `/api/v1/health-insurance/result-push-confirm/` | atualiza status do push |

## Estrutura

```
yzilab-extension/
├── manifest.json
├── background/service-worker.js
├── sidepanel/
│   ├── sidepanel.html / .js
│   └── tabs/login.js, settings.js
├── lib/             # http, storage, messages, logger, yzilab-client, module-registry
├── ui/              # styles.css, components.js
├── modules/petlove/ # index, api, session (content script), inbox-tab, result-push-tab, mapping-modal
└── icons/
```

## Notas

- A chave do `access_token` no `localStorage` da Petlove pode mudar. O content script tenta
  `access_token`, `accessToken`, `auth_token`, `token` (`modules/petlove/session.js`). Se uma
  versão futura do site mudar a chave, ajustar `TOKEN_KEYS`.
- O endpoint legado `POST /health-insurance/petlove/<uuid>/session/` e o código `curl_cffi` em
  `providers/health_insurance/petlove.py` foram **mantidos** mas estão dormentes — a Celery
  task `sync_health_insurance_exam_result` faz early-return para Petlove, deixando a extensão
  como único caminho de push.
