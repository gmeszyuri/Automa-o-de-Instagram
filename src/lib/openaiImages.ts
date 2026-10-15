import { writeFile } from "node:fs/promises";

const API_URL = "https://api.openai.com/v1/images/generations";

// Guia de estilo aplicado a toda ilustração gerada: composição limpa e com
// um único foco visual, evitando cenas carregadas/"desorganizadas" com
// muitos elementos competindo por atenção.
const STYLE_PREFIX =
  "Minimalist, clean editorial illustration with a single clear focal subject and generous empty negative space around it. Simple, uncluttered composition — avoid busy scenes with many competing elements. Muted, limited color palette. Professional, corporate tone. Scene: ";

// Modelos de imagem às vezes "alucinam" texto/logos na cena mesmo quando
// instruídos a não fazer isso. Reforça essa restrição em todo prompt,
// já que o texto e o logo reais são sempre aplicados depois via HTML/CSS.
const NO_TEXT_SUFFIX =
  ". Absolutely no text, letters, words, numbers, watermarks, logos, or typography anywhere in the image — pure visual scene only.";

export interface GenerateImageOptions {
  prompt: string;
  size?: "1024x1024" | "1024x1536" | "1536x1024";
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
        prompt: STYLE_PREFIX + options.prompt + NO_TEXT_SUFFIX,
        size: options.size ?? "1024x1536",
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
