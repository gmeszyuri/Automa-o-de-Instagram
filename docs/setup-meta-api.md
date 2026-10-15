# Passo a passo — Conectar Instagram + Facebook (Meta Graph API)

Objetivo final: um **Page Access Token** de longa duração e dois IDs (`PAGE_ID` e `IG_USER_ID`) que o script vai usar para publicar.

Como é só para o seu próprio negócio publicar nas próprias contas, **não é necessário passar pelo App Review da Meta** — isso só é obrigatório para apps públicos que vão operar em contas de terceiros. Aqui basta registrar você mesmo como admin/tester do App.

## 1. Pré-requisitos

- [ ] Uma **Página do Facebook** da Solution (criar em facebook.com/pages/create se ainda não existir).
- [ ] Uma conta do **Instagram** convertida para **Business** (ou Creator): no app do Instagram → Configurações → Conta → "Mudar para conta profissional" → Business.
- [ ] A conta do Instagram **vinculada** à Página do Facebook: no app do Instagram → Configurações → Conta → "Contas vinculadas" → Facebook → selecionar a Página da Solution.

## 2. Criar o Business Manager

1. Acesse https://business.facebook.com/
2. Crie uma conta de negócios (se ainda não tiver) com o nome "Solution".
3. Em **Configurações do Negócio → Contas → Páginas**, adicione/confirme a Página da Solution.
4. Em **Contas → Contas do Instagram**, adicione a conta do Instagram da Solution.

## 3. Criar o App no Meta for Developers

1. Acesse https://developers.facebook.com/apps/ e clique em **Criar App**.
2. Tipo de app: **Business**.
3. Nome do app: algo como "Solution Automação de Posts".
4. Associe o app ao Business Manager criado no passo 2.
5. No painel do app, adicione o produto **Instagram Graph API** (em "Adicionar produto").

## 4. Adicionar você como Tester/Admin (evita App Review)

1. No painel do app → **Funções do app → Funções**.
2. Garanta que seu usuário do Facebook (o mesmo que administra a Página) está como **Administrador**.
3. Em **App Review → Permissões e Recursos**, você pode testar com permissões padrão sem submeter para revisão, desde que use apenas contas vinculadas a admins/testers do app (que é o seu caso).

## 5. Gerar o Access Token com as permissões certas

1. Vá em **Ferramentas → Graph API Explorer** (https://developers.facebook.com/tools/explorer/).
2. Selecione o seu App no seletor.
3. Em "User or Page", selecione **Get User Access Token**.
4. Marque as permissões:
   - `pages_show_list`
   - `pages_read_engagement`
   - `pages_manage_posts`
   - `instagram_basic`
   - `instagram_content_publish`
   - `business_management`
5. Clique em **Generate Access Token** e autorize.
6. Copie o token gerado (é um **token de curta duração**, dura ~1h — vamos trocar por um de longa duração no próximo passo).

## 6. Trocar por um token de longa duração (60 dias, renovável)

Rode este comando (substitua `APP_ID`, `APP_SECRET` — ficam em Configurações → Básico do app — e `SHORT_TOKEN`):

```bash
curl -i -X GET "https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=APP_ID&client_secret=APP_SECRET&fb_exchange_token=SHORT_TOKEN"
```

Isso devolve um `access_token` válido por ~60 dias. Com esse token de usuário de longa duração, o **Page Access Token** obtido a partir dele (próximo passo) não expira, desde que o token de usuário continue válido e as permissões não sejam revogadas.

## 7. Obter o Page Access Token e os IDs

1. Liste suas páginas e pegue o token específico da Página:

```bash
curl -i -X GET "https://graph.facebook.com/v21.0/me/accounts?access_token=LONG_LIVED_USER_TOKEN"
```

A resposta traz, para cada página: `id` (= `PAGE_ID`) e `access_token` (= `PAGE_ACCESS_TOKEN`, o que vamos usar no `.env`).

2. Pegue o ID da conta do Instagram vinculada a essa Página:

```bash
curl -i -X GET "https://graph.facebook.com/v21.0/PAGE_ID?fields=instagram_business_account&access_token=PAGE_ACCESS_TOKEN"
```

A resposta traz `instagram_business_account.id` (= `IG_USER_ID`).

## 8. Guardar as credenciais

Crie um arquivo `.env` na raiz do projeto (ele é ignorado pelo git, **nunca** commitar):

```
META_PAGE_ID=xxxxxxxxxxxx
META_PAGE_ACCESS_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
META_IG_USER_ID=xxxxxxxxxxxx
```

## 9. Testar a publicação (manual, via curl)

Publicar uma imagem simples no Instagram é em 2 passos: criar o container de mídia e depois publicá-lo.

```bash
# 1. Cria o container
curl -i -X POST "https://graph.facebook.com/v21.0/IG_USER_ID/media" \
  -d "image_url=https://SEU-LINK-PUBLICO-DE-IMAGEM.jpg" \
  -d "caption=Teste de publicação automática 🚀" \
  -d "access_token=PAGE_ACCESS_TOKEN"

# resposta: { "id": "CONTAINER_ID" }

# 2. Publica o container
curl -i -X POST "https://graph.facebook.com/v21.0/IG_USER_ID/media_publish" \
  -d "creation_id=CONTAINER_ID" \
  -d "access_token=PAGE_ACCESS_TOKEN"
```

> A imagem precisa estar acessível por uma **URL pública** (não funciona com arquivo local) — no pipeline final, vamos hospedar as imagens geradas temporariamente (ex: num bucket/pasta pública) antes de publicar.

## Renovação do token

O token de usuário de longa duração dura 60 dias. O script vai ter uma rotina de alerta para você renovar antes de expirar (repetindo o passo 6), ou podemos automatizar a renovação via `fb_exchange_token` chamado periodicamente, desde que o token anterior ainda esteja válido.
