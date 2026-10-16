import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const API_URL = "https://api.openai.com/v1/responses";
const MEDIA_TYPE: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png" };

/** Post de concorrente salvo por `npm run collect-references`. */
export interface ReferencePost {
  handle: string;
  code: string;
  permalink: string;
  likeCount?: number;
  /** Caminho absoluto da primeira imagem do post. */
  imagePath: string;
}

interface SavedIndex {
  handle: string;
  posts: { code: string; permalink: string; mediaType: string; likeCount?: number; localImages: string[] }[];
}

/**
 * Escolhe um post de referência em `references/`.
 * - "handle/code": aquele post específico.
 * - "top": o post com mais likes em relação à média do próprio perfil (comparar
 *   likes absolutos favoreceria sempre a Soluti, que tem muito mais alcance).
 * Retorna null se a coleta ainda não foi feita ou o post não existe.
 */
export async function pickReference(referencesDir: string, selector: string): Promise<ReferencePost | null> {
  let handles: string[];
  try {
    handles = (await readdir(referencesDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return null;
  }

  const candidates: (ReferencePost & { score: number })[] = [];
  for (const handle of handles) {
    let index: SavedIndex;
    try {
      index = JSON.parse(await readFile(path.join(referencesDir, handle, "index.json"), "utf-8"));
    } catch {
      continue;
    }
    const likes = index.posts.map((p) => p.likeCount ?? 0);
    const mean = likes.reduce((a, b) => a + b, 0) / Math.max(likes.length, 1) || 1;
    for (const post of index.posts) {
      const first = post.localImages[0];
      if (!first) continue;
      candidates.push({
        handle,
        code: post.code,
        permalink: post.permalink,
        likeCount: post.likeCount,
        imagePath: path.join(referencesDir, first),
        score: (post.likeCount ?? 0) / mean,
      });
    }
  }

  if (selector === "top") {
    return candidates.sort((a, b) => b.score - a.score)[0] ?? null;
  }
  const [handle, code] = selector.split("/");
  return candidates.find((c) => c.handle === handle && c.code === code) ?? null;
}

// O estilo (meio, luz, paleta, enquadramento, "sem texto") já vem do
// STYLE_PREFIX do OpenAIImagesClient; aqui o modelo escreve só a CENA.
const INSTRUCTIONS = `You are the art director for "Solution Certificado Digital", a Brazilian digital-certificate company.
You receive one Instagram post image from a competitor and the Portuguese headline of a new Solution post.
Your job: write the scene for a NEW photo that illustrates the Solution headline, borrowing only transferable craft from the reference: framing, camera distance and angle, what kind of subject carries the message (hands, a person, an object), how light creates focus, and the emotional tone.

Rules for the scene:
- One clear subject, at most two supporting elements. Nothing busy.
- It must make sense for the Solution headline, not for the competitor's post.
- Ground the subject in a real, concrete object or moment from Brazilian digital-certificate work (a smart card, a USB token, a signed contract, a notary's desk, a specific gesture of signing or verifying) instead of generic corporate stock-photo tropes (handshake, abstract glowing orb, laptop-and-coffee flatlay).
- Never reproduce competitor identity: no logos, mascots (e.g. a dog character), uniforms, recognizable people, their brand colors (orange, electric blue, lime-to-teal gradients), or their signature concepts (music-player/playlist mockups, "RADAR" news series).
- Any phone, monitor or document in the scene is blank or shows only abstract light — never readable UI, text or numbers.
- Describe only content and composition, in English, 1-3 sentences. Do not describe art style, color palette or the text overlay; those are handled elsewhere.`;

const SCHEMA = {
  type: "object",
  properties: {
    referenceTakeaways: {
      type: "string",
      description: "What in the reference makes it work visually, in one sentence (for the human reviewer).",
    },
    scene: { type: "string", description: "The new scene description for the image model." },
  },
  required: ["referenceTakeaways", "scene"],
  additionalProperties: false,
} as const;

export interface ScenePrompt {
  referenceTakeaways: string;
  scene: string;
}

/** Usa um modelo com visão para transformar um post de concorrente + a copy da Solution em prompt de cena. */
export class ReferencePromptWriter {
  constructor(
    private readonly apiKey: string,
    private readonly model: string
  ) {
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY não definido no .env");
    }
  }

  async writeScene(
    reference: ReferencePost,
    headline: string,
    body: string,
    requiredSubject?: string
  ): Promise<ScenePrompt> {
    const mediaType = MEDIA_TYPE[path.extname(reference.imagePath).toLowerCase()] ?? "image/jpeg";
    const imageB64 = (await readFile(reference.imagePath)).toString("base64");

    const subjectConstraint = requiredSubject
      ? `\nMandatory subject: the new scene's main subject MUST be ${requiredSubject}, regardless of what the reference image's own subject is. Adapt only the transferable craft (framing, light, mood, camera distance) from the reference — not its subject type.`
      : "";

    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        instructions: INSTRUCTIONS,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `Solution headline: ${headline}\nSupporting text: ${body}${subjectConstraint}`,
              },
              { type: "input_image", image_url: `data:${mediaType};base64,${imageB64}` },
            ],
          },
        ],
        text: { format: { type: "json_schema", name: "scene_prompt", strict: true, schema: SCHEMA } },
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`OpenAI Responses ${response.status}: ${text.slice(0, 500)}`);
    }

    const data = (await response.json()) as {
      output?: { content?: { type: string; text?: string; refusal?: string }[] }[];
    };
    const parts = (data.output ?? []).flatMap((item) => item.content ?? []);
    const refusal = parts.find((p) => p.type === "refusal");
    if (refusal) {
      throw new Error(`Modelo recusou gerar a cena: ${refusal.refusal}`);
    }
    const text = parts.find((p) => p.type === "output_text")?.text;
    if (!text) {
      throw new Error("Resposta da OpenAI não trouxe texto (output_text ausente)");
    }
    return JSON.parse(text) as ScenePrompt;
  }
}
