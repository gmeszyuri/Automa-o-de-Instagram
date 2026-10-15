# Passo a passo — Bot do Telegram para aprovação de posts

Objetivo final: um `TELEGRAM_BOT_TOKEN` e o seu `TELEGRAM_CHAT_ID`, para o script enviar os rascunhos (imagem + copy) e você aprovar direto pelo celular.

## 1. Criar o bot

1. Abra o Telegram e procure por **@BotFather** (é o bot oficial para criar outros bots).
2. Envie `/newbot`.
3. Escolha um **nome** para o bot (ex: `Solution Posts Bot`).
4. Escolha um **username** terminando em `bot` (ex: `solution_posts_bot`).
5. O BotFather vai responder com um token parecido com:
   ```
   123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw
   ```
   Esse é o seu `TELEGRAM_BOT_TOKEN`. Guarde com cuidado.

## 2. Pegar o seu chat_id

1. No Telegram, procure o bot que você acabou de criar pelo username escolhido e clique em **Iniciar** (`/start`).
2. Envie qualquer mensagem para ele (ex: "oi").
3. No navegador, acesse (substituindo o token):
   ```
   https://api.telegram.org/botSEU_TOKEN/getUpdates
   ```
4. Na resposta JSON, procure por `"chat":{"id":NUMERO, ...}` — esse `NUMERO` é o seu `TELEGRAM_CHAT_ID`.

## 3. Guardar as credenciais

Adicione no `.env`:

```
TELEGRAM_BOT_TOKEN=123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw
TELEGRAM_CHAT_ID=987654321
```

## 4. Testar o envio

```bash
curl -s -X POST "https://api.telegram.org/botSEU_TOKEN/sendMessage" \
  -d "chat_id=SEU_CHAT_ID" \
  -d "text=Teste do bot de aprovação de posts 🚀"
```

Se a mensagem chegar no seu Telegram, está tudo certo.

## Como vai funcionar no pipeline

Quando a automação gerar um rascunho (imagem/carrossel + copy), o bot vai:

1. Enviar a(s) imagem(ns) geradas + a legenda proposta.
2. Enviar botões inline: **✅ Aprovar e agendar** / **✏️ Pedir ajuste** / **❌ Descartar**.
3. Se aprovado, o script segue para a publicação via Meta Graph API.
4. Se "pedir ajuste", você pode responder com o que quer mudar (ex: "troca a cor de fundo" ou "muda a legenda") e o pipeline gera uma nova versão.
