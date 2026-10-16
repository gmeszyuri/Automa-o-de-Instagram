import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ScrapeCreatorsClient, type InstagramPost } from "./lib/scrapeCreators.js";

const OUTPUT_DIR = path.resolve("references");

const MEDIA_TYPE_VIDEO = 2;
const MEDIA_TYPE_CAROUSEL = 8;

interface SavedPostMeta {
  code: string;
  permalink: string;
  mediaType: "image" | "carousel";
  slideCount: number;
  caption: string;
  likeCount?: number;
  commentCount?: number;
  takenAt?: string;
  localImages: string[];
}

interface SavedIndex {
  handle: string;
  collectedAt: string;
  posts: SavedPostMeta[];
}

function extractHandleAndCode(postUrl: string): { code: string } {
  const match = postUrl.match(/instagram\.com\/p\/([^/?]+)/);
  if (!match) {
    throw new Error(`Não consegui extrair o código do post da URL: ${postUrl}`);
  }
  return { code: match[1] };
}

/**
 * A API não documenta publicamente a forma da resposta de /v1/instagram/post.
 * Tenta os formatos mais prováveis (mesmo "formato nativo" usado por
 * /v2/instagram/user/posts) antes de desistir. Se nenhum bater, quem chama
 * deve inspecionar o arquivo *-raw.json salvo e ajustar esta função.
 */
function resolvePostFromRawResponse(raw: unknown): InstagramPost | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const candidates: unknown[] = [
    obj.post,
    obj.data,
    Array.isArray(obj.items) ? obj.items[0] : undefined,
    obj,
  ];

  for (const candidate of candidates) {
    if (
      candidate &&
      typeof candidate === "object" &&
      "code" in candidate &&
      "media_type" in candidate
    ) {
      return candidate as InstagramPost;
    }
  }
  return null;
}

function bestImageUrl(candidates?: { url: string; width: number }[]): string | undefined {
  if (!candidates || candidates.length === 0) return undefined;
  return [...candidates].sort((a, b) => b.width - a.width)[0]?.url;
}

async function downloadImage(url: string, destPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Falha ao baixar imagem (${response.status}): ${url}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(destPath, buffer);
}

async function main() {
  const postUrl = process.argv[2];
  const handle = process.argv[3];
  if (!postUrl || !handle) {
    console.error("Uso: npm run fetch-reference-post -- <url-do-post> <handle-do-perfil>");
    console.error(
      'Exemplo: npm run fetch-reference-post -- "https://www.instagram.com/p/DY2Acs0oMbL/" acertcertisign'
    );
    process.exitCode = 1;
    return;
  }

  const apiKey = process.env.SCRAPECREATORS_API_KEY ?? "";
  const client = new ScrapeCreatorsClient(apiKey);
  const { code: codeFromUrl } = extractHandleAndCode(postUrl);

  console.log(`Buscando post ${postUrl}...`);
  const raw = await client.getPostRaw(postUrl);

  const profileDir = path.join(OUTPUT_DIR, handle);
  await mkdir(profileDir, { recursive: true });
  const rawDebugPath = path.join(profileDir, `${codeFromUrl}-raw.json`);
  await writeFile(rawDebugPath, JSON.stringify(raw, null, 2));
  console.log(`  Resposta bruta salva em ${rawDebugPath} (para debug, caso o parse falhe)`);

  const post = resolvePostFromRawResponse(raw);
  if (!post) {
    console.error(
      "\nNão consegui reconhecer o formato da resposta da API. Abra o arquivo *-raw.json acima,\n" +
        "veja onde estão os campos 'code', 'media_type', 'caption', 'image_versions2' e ajuste\n" +
        "resolvePostFromRawResponse() em src/fetch-reference-post.ts."
    );
    process.exitCode = 1;
    return;
  }

  const code = post.code || codeFromUrl;
  const postDir = path.join(profileDir, code);
  await mkdir(postDir, { recursive: true });

  const slides =
    post.media_type === MEDIA_TYPE_CAROUSEL
      ? (post.carousel_media ?? []).filter((m) => m.media_type !== MEDIA_TYPE_VIDEO)
      : [post];

  const localImages: string[] = [];
  for (let i = 0; i < slides.length; i++) {
    const imageUrl = bestImageUrl(slides[i].image_versions2?.candidates);
    if (!imageUrl) continue;
    const fileName = `slide-${String(i + 1).padStart(2, "0")}.jpg`;
    const destPath = path.join(postDir, fileName);
    await downloadImage(imageUrl, destPath);
    localImages.push(path.relative(OUTPUT_DIR, destPath));
    console.log(`  + slide-${i + 1} baixado`);
  }

  if (localImages.length === 0) {
    console.error("Nenhuma imagem baixada — confira o *-raw.json pra ver se o post tem mídia.");
    process.exitCode = 1;
    return;
  }

  const meta: SavedPostMeta = {
    code,
    permalink: postUrl,
    mediaType: post.media_type === MEDIA_TYPE_CAROUSEL ? "carousel" : "image",
    slideCount: localImages.length,
    caption: post.caption?.text ?? "",
    likeCount: post.like_count,
    commentCount: post.comment_count,
    takenAt: post.taken_at ? new Date(post.taken_at * 1000).toISOString() : undefined,
    localImages,
  };
  await writeFile(path.join(postDir, "meta.json"), JSON.stringify(meta, null, 2));

  // Mescla no index.json do perfil (cria se não existir, ou atualiza o post se já existir).
  const indexPath = path.join(profileDir, "index.json");
  let index: SavedIndex;
  try {
    index = JSON.parse(await readFile(indexPath, "utf-8"));
  } catch {
    index = { handle, collectedAt: new Date().toISOString(), posts: [] };
  }
  index.posts = [...index.posts.filter((p) => p.code !== code), meta];
  await writeFile(indexPath, JSON.stringify(index, null, 2));

  console.log(`\nPronto. Use reference: "${handle}/${code}" nos specs do render-template.ts.`);
}

main().catch((err) => {
  console.error("Erro fatal:", err);
  process.exitCode = 1;
});
