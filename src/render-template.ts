import "dotenv/config";
import { chromium } from "playwright-core";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { OpenAIImagesClient } from "./lib/openaiImages.js";
import { pickReference, ReferencePromptWriter } from "./lib/referencePrompt.js";

const TEMPLATES_DIR = path.resolve("templates");
const OUTPUT_DIR = path.resolve("templates/output");
const ILLUSTRATIONS_DIR = path.join(OUTPUT_DIR, "illustrations");
const REFERENCES_DIR = path.resolve("references");
// Modelo com visão que lê o post do concorrente e escreve a cena.
const SCENE_MODEL = process.env.OPENAI_SCENE_MODEL || "gpt-5-mini";
// Sem PLAYWRIGHT_CHROMIUM_PATH, deixa o playwright-core localizar o Chromium
// automaticamente (via PLAYWRIGHT_BROWSERS_PATH ou o cache padrão do SO,
// preenchido por `npx playwright install chromium`).
const CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH;

const WIDTH = 1080;
const HEIGHT = 1350;

type TemplateTokens = Record<string, string>;

function render(templateHtml: string, tokens: TemplateTokens): string {
  let output = templateHtml;
  for (const [key, value] of Object.entries(tokens)) {
    output = output.replaceAll(`{{${key}}}`, value);
  }
  // remove any token placeholders left blank
  output = output.replace(/\{\{\w+\}\}/g, "");
  return output;
}

function badge(text?: string): string {
  if (!text) return "";
  return `<div class="badge">${text}</div>`;
}

function slideIndex(current?: number, total?: number): string {
  if (!current || !total) return "";
  return `<div class="slide-index">${current}/${total}</div>`;
}

function listItems(items: string[]): string {
  return items
    .map(
      (text, i) => `
    <li class="list-item">
      <span class="list-number">${i + 1}</span>
      <span class="list-text">${text}</span>
    </li>`
    )
    .join("\n");
}

function alertCards(items: AlertCardItem[]): string {
  return items
    .map(
      (item) => `
    <div class="alert-card">
      <span class="alert-card-badge">${item.badge}</span>
      <span class="alert-card-icon">${item.icon}</span>
      <div>
        <div class="alert-card-title">${item.title}</div>
        <div class="alert-card-body">${item.body}</div>
      </div>
    </div>`
    )
    .join("\n");
}

interface AlertCardItem {
  badge: string;
  icon: string;
  title: string;
  body: string;
}

interface SlideSpec {
  template:
    | "single-hook"
    | "carousel-content"
    | "carousel-cta"
    | "illustrated-hook"
    | "quote-portrait"
    | "carousel-alert-cards";
  background: "dark" | "light";
  badgeText?: string;
  headlineHtml: string;
  bodyHtml?: string;
  listItemsText?: string[];
  /** Apenas para template "carousel-alert-cards": lista de cards de alerta. */
  alertItems?: AlertCardItem[];
  ctaPillText?: string;
  ctaText?: string;
  slidePosition?: [number, number];
  outputFile: string;
  /**
   * Apenas para templates "illustrated-hook"/"quote-portrait": post de
   * concorrente que inspira a cena ("top" ou "handle/code" de references/).
   * Um modelo com visão lê a imagem e escreve a cena para a headline deste slide.
   */
  reference?: string;
  /**
   * Apenas para templates "illustrated-hook"/"quote-portrait": cena em inglês
   * escrita à mão. Usada quando não há `reference` ou quando a coleta de
   * referências ainda não foi feita.
   */
  illustrationPrompt?: string;
  /** Apenas para template "illustrated-hook": texto do handle exibido na lateral. */
  handleText?: string;
  /** Apenas para template "quote-portrait": rótulo pequeno do contato (ex: "Entre em contato"). */
  contactLabel?: string;
  /** Apenas para template "quote-portrait": valor em destaque do contato (ex: telefone). */
  contactValue?: string;
}

const LOGO_FOR_BG = {
  // PNGs transparentes recortados (gerados a partir dos JPGs): os JPGs
  // têm fundo sólido e viravam um quadrado visível, com o logo minúsculo dentro.
  dark: "../assets/brand/logo-transparent.png",
  light: "../assets/brand/logo-transparent-light.png",
};

interface AiClients {
  images: OpenAIImagesClient;
  scenes: ReferencePromptWriter;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").trim();
}

/** Decide a cena da ilustração: a partir do post de referência, se houver, senão o prompt manual. */
async function resolveScene(spec: SlideSpec, ai: AiClients): Promise<{ scene: string; notes: string }> {
  if (spec.reference) {
    const ref = await pickReference(REFERENCES_DIR, spec.reference);
    if (ref) {
      console.log(`  ... lendo referência @${ref.handle}/${ref.code} para escrever a cena`);
      const result = await ai.scenes.writeScene(ref, stripHtml(spec.headlineHtml), stripHtml(spec.bodyHtml ?? ""));
      return {
        scene: result.scene,
        notes: `Referência: ${ref.permalink} (${ref.likeCount ?? "?"} likes)\nO que funciona nela: ${result.referenceTakeaways}`,
      };
    }
    console.warn(
      `  ! Referência "${spec.reference}" não encontrada em references/ (rode npm run collect-references); usando o prompt manual`
    );
  }
  if (!spec.illustrationPrompt) {
    throw new Error(`Slide ${spec.outputFile} não tem reference válida nem illustrationPrompt`);
  }
  return { scene: spec.illustrationPrompt, notes: "Prompt manual (sem referência)" };
}

async function generateIllustration(ai: AiClients, spec: SlideSpec): Promise<string> {
  await mkdir(ILLUSTRATIONS_DIR, { recursive: true });
  const fileName = `illustration-${spec.outputFile}`;
  const destPath = path.join(ILLUSTRATIONS_DIR, fileName);
  const { scene, notes } = await resolveScene(spec, ai);
  // Guarda a cena usada ao lado da imagem, para revisar por que ela saiu assim.
  await writeFile(destPath.replace(/\.png$/, ".prompt.txt"), `${notes}\n\nCena: ${scene}\n`);
  // "illustrated-hook" usa uma moldura paisagem 1080x780 (1536x1024 perde só as
  // bordas laterais); "quote-portrait" cobre o slide inteiro 1080x1350, então
  // pede retrato para não perder altura no recorte.
  const size = spec.template === "quote-portrait" ? "1024x1536" : "1536x1024";
  await ai.images.generateToFile({ prompt: scene, size }, destPath);
  // caminho relativo a partir de templates/, onde o HTML temporário é escrito
  return `output/illustrations/${fileName}`;
}

async function renderSlide(
  browser: import("playwright-core").Browser,
  spec: SlideSpec,
  ai: AiClients | null
) {
  const templatePath = path.join(TEMPLATES_DIR, `${spec.template}.html`);
  const templateHtml = await readFile(templatePath, "utf-8");

  let illustrationSrc = "";
  if (spec.template === "illustrated-hook" || spec.template === "quote-portrait") {
    if (!ai) {
      console.warn(`  ! Pulando ${spec.outputFile}: OPENAI_API_KEY não configurado`);
      return;
    }
    console.log(`  ... gerando ilustração para ${spec.outputFile} via OpenAI`);
    illustrationSrc = await generateIllustration(ai, spec);
  }

  const contactHtml =
    spec.contactLabel || spec.contactValue
      ? `${spec.contactLabel ? `<span>${spec.contactLabel}</span>` : ""}${
          spec.contactValue ? `<strong>${spec.contactValue}</strong>` : ""
        }`
      : "";

  const html = render(templateHtml, {
    logoSrc: LOGO_FOR_BG[spec.background],
    illustrationSrc,
    handleText: spec.handleText ?? "@solutioncertificado",
    slideIndexHtml: slideIndex(spec.slidePosition?.[0], spec.slidePosition?.[1]),
    badgeHtml: badge(spec.badgeText),
    headlineHtml: spec.headlineHtml,
    bodyHtml: spec.bodyHtml ?? "",
    listHtml: spec.listItemsText ? listItems(spec.listItemsText) : "",
    alertCardsHtml: spec.alertItems ? alertCards(spec.alertItems) : "",
    ctaPillHtml: spec.ctaPillText ? `<span class="cta-pill">${spec.ctaPillText}</span>` : "",
    ctaTextHtml: spec.ctaText ? `<span class="cta-text">${spec.ctaText}</span>` : "",
    contactHtml,
  });

  // Escreve um HTML temporário dentro de templates/ para que os caminhos
  // relativos (styles.css, logo, ilustração) resolvam corretamente via file://.
  const tempHtmlPath = path.join(TEMPLATES_DIR, `.tmp-${spec.outputFile}.html`);
  await writeFile(tempHtmlPath, html);

  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  await page.goto(`file://${tempHtmlPath}`, { waitUntil: "networkidle" });
  // "networkidle" não garante que a fonte do Google Fonts (Poppins) já foi
  // aplicada ao texto — sem isso o screenshot às vezes sai com a fonte
  // padrão do sistema em vez da Poppins.
  await page.evaluate(() => document.fonts.ready);
  const outputPath = path.join(OUTPUT_DIR, spec.outputFile);
  await page.screenshot({ path: outputPath });
  await page.close();
  await rm(tempHtmlPath, { force: true });
  console.log(`  + ${spec.outputFile}`);
}

const sampleCarousel: SlideSpec[] = [
  {
    template: "single-hook",
    background: "dark",
    badgeText: "RADAR SOLUTION",
    headlineHtml: `4 sinais de que seu certificado está <mark>vencendo</mark>`,
    bodyHtml: "Antes que vire dor de cabeça na hora de assinar, confira os alertas que costumam aparecer primeiro.",
    ctaPillText: "Veja no carrossel",
    ctaText: "Arraste para o lado →",
    slidePosition: [1, 4],
    outputFile: "sample-slide-01.png",
  },
  {
    template: "carousel-content",
    background: "light",
    headlineHtml: "Fique de olho nestes alertas",
    listItemsText: [
      "O sistema avisa que o certificado vence em poucos dias",
      "A assinatura começa a falhar sem motivo aparente",
      "O token ou cartão não é mais reconhecido pelo computador",
      "Mensagens de erro aparecem só em alguns sistemas",
    ],
    slidePosition: [2, 4],
    outputFile: "sample-slide-02.png",
  },
  {
    template: "carousel-content",
    background: "light",
    headlineHtml: "Por que renovar antes do vencimento?",
    listItemsText: [
      "Evita parar operações importantes de última hora",
      "Mantém assinaturas e acessos funcionando sem interrupção",
      "Dá tempo de resolver qualquer problema com calma",
    ],
    slidePosition: [3, 4],
    outputFile: "sample-slide-03.png",
  },
  {
    template: "carousel-cta",
    background: "dark",
    headlineHtml: `Não deixe para <mark>última hora</mark>`,
    bodyHtml: "A Solution ajuda você a renovar com agilidade e sem burocracia.",
    ctaPillText: "Fale com a gente",
    ctaText: "Link na bio",
    slidePosition: [4, 4],
    outputFile: "sample-slide-04.png",
  },
];

const illustratedSample: SlideSpec[] = [
  {
    template: "illustrated-hook",
    background: "dark",
    badgeText: "RADAR SOLUTION",
    headlineHtml: `O número na tela pode <mark>mentir</mark>`,
    bodyHtml: "Golpistas falsificam o identificador de chamadas para parecer uma ligação oficial.",
    handleText: "@solutioncertificado",
    reference: "top",
    illustrationPrompt:
      "A hand placing an ICP-Brasil USB security token into a laptop at a real desk, seen from a slight side angle, the token catching a thin red warning-colored glint; dark, out-of-focus office background",
    outputFile: "sample-illustrated-01.png",
  },
];

const quotePortraitSample: SlideSpec[] = [
  {
    template: "quote-portrait",
    background: "dark",
    headlineHtml: `“Atenção: seu certificado <mark class="alert">vence hoje</mark>.”`,
    bodyHtml: `Essa frase já pegou contador, advogado e empresário de surpresa. <mark>Você reconheceria o aviso?</mark>`,
    reference: "top",
    illustrationPrompt:
      "Three-quarter portrait of a confident Brazilian businesswoman in her 40s wearing a navy blazer, arms crossed, standing in a modern office with soft window light from one side, shallow depth of field",
    contactLabel: "Entre em contato",
    contactValue: "0800 123 4567",
    outputFile: "sample-quote-01.png",
  },
];

const alertCardsSample: SlideSpec[] = [
  {
    template: "carousel-alert-cards",
    background: "dark",
    headlineHtml: "Antes de clicar, observe estes sinais:",
    alertItems: [
      {
        badge: "Sinal de alerta 1:",
        icon: "⏱️",
        title: "Pressa artificial",
        body: "Se a mensagem empurra você pra clicar “agora” ou “em minutos”, desconfie.",
      },
      {
        badge: "Sinal de alerta 2:",
        icon: "🪪",
        title: "Pedido de dados sensíveis",
        body: "CPF, senha ou foto de documento através de um link fora do site oficial da certificadora.",
      },
      {
        badge: "Sinal de alerta 3:",
        icon: "💸",
        title: "Cobrança avulsa",
        body: "Feita por PIX ou boleto, sem contrato, sem nota fiscal, sem contato prévio com a empresa.",
      },
    ],
    slidePosition: [3, 4],
    outputFile: "sample-alert-cards-01.png",
  },
];

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const openaiKey = process.env.OPENAI_API_KEY;
  const ai: AiClients | null = openaiKey
    ? { images: new OpenAIImagesClient(openaiKey), scenes: new ReferencePromptWriter(openaiKey, SCENE_MODEL) }
    : null;
  if (!ai) {
    console.log("Aviso: OPENAI_API_KEY não definido — exemplos com ilustração de IA serão pulados.\n");
  }

  // channel "chromium" força o uso do Chrome completo em vez da variante
  // "headless shell", que falha em algumas instalações do Windows.
  const browser = await chromium.launch(
    CHROMIUM_PATH ? { executablePath: CHROMIUM_PATH } : { channel: "chromium" }
  );
  try {
    console.log("Renderizando carrossel de amostra...");
    for (const spec of sampleCarousel) {
      await renderSlide(browser, spec, ai);
    }

    console.log("\nRenderizando exemplo com ilustração de IA...");
    for (const spec of illustratedSample) {
      await renderSlide(browser, spec, ai);
    }

    console.log("\nRenderizando exemplo de retrato com citação...");
    for (const spec of quotePortraitSample) {
      await renderSlide(browser, spec, ai);
    }

    console.log("\nRenderizando exemplo de cards de alerta...");
    for (const spec of alertCardsSample) {
      await renderSlide(browser, spec, ai);
    }
  } finally {
    await browser.close();
  }

  console.log(`\nConcluído. Imagens em ${OUTPUT_DIR}`);
}

main().catch((err) => {
  console.error("Erro fatal:", err);
  process.exitCode = 1;
});
