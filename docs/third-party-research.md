# Pesquisa de projetos de terceiros (16/10/2026)

Repositórios públicos lidos a pedido do usuário, buscando técnicas e ideias pra melhorar nosso pipeline próprio.

- https://github.com/Hainrixz/open-carrusel (app web interativo, HTML/CSS + Puppeteer)
- https://github.com/jeevanbavandla/instagram-carousel-skill (skill Claude, HTML/CSS + Playwright)
- https://github.com/EliteSystemsAI/instagram-carousel-generator (não lido a fundo — descrição similar ao acima)
- https://github.com/draphael123/carousel-generator (não lido a fundo — reaproveita conteúdo longo, caso de uso diferente do nosso)
- https://github.com/alsk1992/instagram-ai-agent (agente autônomo completo)

## Adotado

1. **Espera explícita de fonte antes do screenshot** (`src/render-template.ts`): `networkidle` não garante que a fonte do Google Fonts já foi aplicada ao texto. Adicionamos `await page.evaluate(() => document.fonts.ready)` depois do `goto`, evitando screenshots com fonte de fallback do sistema em vez da Poppins.
2. **Regras de copy** (`config/content-brief.json`): uma mensagem por slide, legível em 3-4 segundos, contraste mínimo 4.5:1 — pra orientar a geração de copy na Fase 5.

## Rejeitado (com justificativa)

- **`instagram-ai-agent`**: usa API não-oficial do Instagram (login usuário/senha via `instagrapi`), o oposto da decisão já tomada de usar a Meta Graph API oficial. Risco real de banimento da conta. Também faz auto-follow/auto-reply/DM automático, muito além do escopo pedido.
- **Adotar o `instagram-carousel-skill` ou `open-carrusel` inteiros**: ambos são ferramentas genéricas pra qualquer criador (perfil pessoal, foto de perfil, handle), sem análise de concorrente nem geração de ilustração por IA — perderíamos o que já construímos de específico pra Solution (coleta/análise de concorrentes, cena de IA informada por referência, mitigação de risco de cor).
- **Viewport pequeno (420x525) + `device_scale_factor` pra exportar em 1080x1350**: técnica legítima (usada pelas duas skills) pra manter um preview pequeno pixel-perfect ao exportar grande. Não se aplica a nós porque não temos preview interativo — renderizamos direto em 1080x1350, mais simples pro nosso caso de uso (pipeline automatizado, não editor visual).

## Decisão em aberto: zona segura do grid do Instagram

O `open-carrusel` tem um componente (`SafeZoneOverlay.tsx`) que visualiza algo que não tínhamos considerado: no **grid do perfil** (visualização em miniatura, 3 colunas), o Instagram corta um post 4:5 (1080x1350) para quadrado (1080x1080), **cortando ~135px do topo e ~135px da base**. Ou seja: o conteúdo nos ~10% superiores e inferiores do slide fica invisível na miniatura do grid (só aparece ao abrir o post).

Hoje nossos templates colocam o **logo perto do topo** (56px) e o **CTA/contato perto da base** (~64px de padding) — dentro dessa zona de corte. Isso significa que, na visualização em grid, logo e CTA não aparecem; só aparecem ao abrir o post.

**Isso não é um bug** — é exatamente o padrão que vimos nos 3 concorrentes analisados (ACERT, Safeweb, Soluti colocam logo/contato bem perto das bordas também). A troca é: seguir a convenção do nicho (prioriza a conversão no post aberto) vs. garantir que logo/CTA também apareçam no grid (mais seguro pra reconhecimento de marca ao rolar o feed, mas foge do padrão visual dos concorrentes).

**Não alterei nada ainda** — fica pra você decidir se vale ajustar o espaçamento dos templates pra respeitar essa zona segura, ou manter como está.
