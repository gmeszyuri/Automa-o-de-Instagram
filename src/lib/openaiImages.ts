import { writeFile } from "node:fs/promises";

const API_URL = "https://api.openai.com/v1/images/generations";

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
        prompt: options.prompt,
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
