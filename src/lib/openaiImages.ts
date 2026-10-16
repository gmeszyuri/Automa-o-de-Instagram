import { writeFile } from "node:fs/promises";

const API_URL = "https://api.openai.com/v1/images/generations";

// Direção de arte aplicada a toda imagem gerada. Define UM meio só (foto
// editorial — misturar "illustration" com termos de fotografia gerava um
// resultado híbrido artificial), a paleta da marca e o enquadramento do
// template illustrated-hook: faixa horizontal 1080x780 cuja base é coberta
// pelo card escuro (#081A17), por isso a base da imagem precisa escurecer
// para esse mesmo tom.
const STYLE_PREFIX = [
  "Cinematic editorial photograph, shot on a full-frame camera with a 50mm lens, natural soft key light from one side and deep shadows, high detail, realistic skin and materials.",
  "Wide horizontal frame with one clear subject placed in the upper-center; the lower third of the frame fades into a very dark green-black (#081A17).",
  "Color palette: dominant near-black and deep green tones, with a single small accent of vivid neon green (#2BF14E) light; no other saturated colors.",
  "Calm, trustworthy, modern mood.",
  "Scene:",
].join(" ");

// Modelos de imagem às vezes "alucinam" texto/logos na cena mesmo quando
// instruídos a não fazer isso. Texto e logo reais são sempre aplicados
// depois via HTML/CSS, então a cena precisa sair limpa — e telas/placas
// devem ser descritas como vazias no próprio prompt da cena.
const NO_TEXT_SUFFIX =
  " The image contains no text, lettering, numbers, logos or watermarks; any screens or signs are blank or show only abstract light.";

export interface GenerateImageOptions {
  prompt: string;
  size?: "1024x1024" | "1024x1536" | "1536x1024";
  quality?: "low" | "medium" | "high";
}

export class OpenAIImagesClient {
  constructor(private readonly apiKey: string) {
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY não definido no .env");
    }
  }

  /** Gera uma imagem e salva como arquivo PNG local. Retorna o caminho salvo. */
  async generateToFile(options: GenerateImageOptions, destPath: string): Promise<string> {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt: `${STYLE_PREFIX} ${options.prompt.trim().replace(/\.?$/, ".")}${NO_TEXT_SUFFIX}`,
        size: options.size ?? "1536x1024",
        quality: options.quality ?? "high",
        n: 1,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`OpenAI Images ${response.status}: ${body.slice(0, 500)}`);
    }

    const data = (await response.json()) as { data: { b64_json: string }[] };
    const base64 = data.data[0]?.b64_json;
    if (!base64) {
      throw new Error("Resposta da OpenAI não trouxe imagem (b64_json ausente)");
    }

    await writeFile(destPath, Buffer.from(base64, "base64"));
    return destPath;
  }
}
