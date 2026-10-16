import "dotenv/config";
import { chromium } from "playwright-core";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { OpenAIImagesClient } from "./lib/openaiImages.js";

const TEMPLATES_DIR = path.resolve("templates");
const OUTPUT_DIR = path.resolve("templates/output");
const ILLUSTRATIONS_DIR = path.join(OUTPUT_DIR, "illustrations");
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

interface SlideSpec {
  template: "single-hook" | "carousel-content" | "carousel-cta" | "illustrated-hook";
  background: "dark" | "light";
  badgeText?: string;
  headlineHtml: string;
  bodyHtml?: string;
  listItemsText?: string[];
  ctaPillText?: string;
  ctaText?: string;
  slidePosition?: [number, number];
  outputFile: string;
  /** Apenas para template "illustrated-hook": prompt em inglês para a IA gerar o fundo. */
  illustrationPrompt?: string;
  /** Apenas para template "illustrated-hook": texto do handle exibido na lateral. */
  handleText?: string;
}

const LOGO_FOR_BG = {
  dark: "../assets/brand/logo-dark-bg.jpg",
  light: "../assets/brand/logo-light-bg.jpg",
};

async function generateIllustration(
  openai: OpenAIImagesClient,
  prompt: string,
  outputFile: string
): Promise<string> {
  await mkdir(ILLUSTRATIONS_DIR, { recursive: true });
  const fileName = `illustration-${outputFile}`;
  const destPath = path.join(ILLUSTRATIONS_DIR, fileName);
  await openai.generateToFile({ prompt, size: "1024x1536" }, destPath);
  // caminho relativo a partir de templates/, onde o HTML temporário é escrito
  return `output/illustrations/${fileName}`;
}

async function renderSlide(
  browser: import("playwright-core").Browser,
  spec: SlideSpec,
  openai: OpenAIImagesClient | null
) {
  const templatePath = path.join(TEMPLATES_DIR, `${spec.template}.html`);
  const templateHtml = await readFile(templatePath, "utf-8");

  let illustrationSrc = "";
  if (spec.template === "illustrated-hook") {
    if (!spec.illustrationPrompt) {
      throw new Error(`Slide ${spec.outputFile} usa illustrated-hook mas não tem illustrationPrompt`);
    }
    if (!openai) {
      console.warn(`  ! Pulando ${spec.outputFile}: OPENAI_API_KEY não configurado`);
      return;
    }
    console.log(`  ... gerando ilustração para ${spec.outputFile} via OpenAI`);
    illustrationSrc = await generateIllustration(openai, spec.illustrationPrompt, spec.outputFile);
  }

  const html = render(templateHtml, {
    logoSrc: LOGO_FOR_BG[spec.background],
    illustrationSrc,
    handleText: spec.handleText ?? "@solutioncertificado",
    slideIndexHtml: slideIndex(spec.slidePosition?.[0], spec.slidePosition?.[1]),
    badgeHtml: badge(spec.badgeText),
    headlineHtml: spec.headlineHtml,
    bodyHtml: spec.bodyHtml ?? "",
    listHtml: spec.listItemsText ? listItems(spec.listItemsText) : "",
    ctaPillHtml: spec.ctaPillText ? `<span class="cta-pill">${spec.ctaPillText}</span>` : "",
    ctaTextHtml: spec.ctaText ? `<span class="cta-text">${spec.ctaText}</span>` : "",
  });

  // Escreve um HTML temporário dentro de templates/ para que os caminhos
  // relativos (styles.css, logo, ilustração) resolvam corretamente via file://.
  const tempHtmlPath = path.join(TEMPLATES_DIR, `.tmp-${spec.outputFile}.html`);
  await writeFile(tempHtmlPath, html);

  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  await page.goto(`file://${tempHtmlPath}`, { waitUntil: "networkidle" });
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
    illustrationPrompt:
      "A single person's hand holding a smartphone, the screen glowing with a soft red alert light, dark teal background, close-up, shallow depth of field, vertical composition",
    outputFile: "sample-illustrated-01.png",
  },
];

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const openaiKey = process.env.OPENAI_API_KEY;
  const openai = openaiKey ? new OpenAIImagesClient(openaiKey) : null;
  if (!openai) {
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
      await renderSlide(browser, spec, openai);
    }

    console.log("\nRenderizando exemplo com ilustração de IA...");
    for (const spec of illustratedSample) {
      await renderSlide(browser, spec, openai);
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
