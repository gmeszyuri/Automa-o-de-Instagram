import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ScrapeCreatorsClient } from "./lib/scrapeCreators.js";

const OUTPUT_DIR = path.resolve("references");

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

function extractCode(postUrl: string): string {
  const match = postUrl.match(/instagram\.com\/p\/([^/?]+)/);
  if (!match) {
    throw new Error(`Não consegui extrair o código do post da URL: ${postUrl}`);
  }
  return match[1];
}

/** Um nó de mídia do shape GraphQL nativo do Instagram (post único ou filho de carrossel). */
interface GraphQLMediaNode {
  __typename?: string;
  is_video?: boolean;
  display_url?: string;
}

interface GraphQLShortcodeMedia {
  __typename?: string;
  shortcode?: string;
  display_url?: string;
  is_video?: boolean;
  taken_at_timestamp?: number;
  comment_count?: number;
  edge_media_to_caption?: { edges?: { node?: { text?: string } }[] };
  edge_media_preview_like?: { count?: number };
  edge_sidecar_to_children?: { edges?: { node?: GraphQLMediaNode }[] };
}

interface ExtractedPost {
  code: string;
  mediaType: "image" | "carousel";
  imageUrls: string[];
  caption: string;
  likeCount?: number;
  commentCount?: number;
  takenAt?: string;
}

/**
 * Extrai os campos que usamos a partir do shape GraphQL nativo do Instagram
 * (resposta de /v1/instagram/post: { data: { xdt_shortcode_media: {...} } }).
 * Confirmado em 17/10/2026 a partir de uma resposta real da API — ver
 * references/<handle>/<code>-raw.json salvo por este script para o shape
 * completo caso a API mude ou um carrossel traga campos diferentes.
 */
export function extractFromGraphQLResponse(raw: unknown): ExtractedPost | null {
  const media = (raw as { data?: { xdt_shortcode_media?: GraphQLShortcodeMedia } } | undefined)
    ?.data?.xdt_shortcode_media;
  if (!media || !media.shortcode) return null;

  const caption = media.edge_media_to_caption?.edges?.[0]?.node?.text ?? "";
  const likeCount = media.edge_media_preview_like?.count;
  const commentCount = media.comment_count;
  const takenAt = media.taken_at_timestamp
    ? new Date(media.taken_at_timestamp * 1000).toISOString()
    : undefined;

  const isSidecar = media.__typename === "XDTGraphSidecar";
  const imageUrls: string[] = [];

  if (isSidecar) {
    for (const edge of media.edge_sidecar_to_children?.edges ?? []) {
      const node = edge.node;
      if (node && !node.is_video && node.display_url) {
        imageUrls.push(node.display_url);
      }
    }
  } else if (!media.is_video && media.display_url) {
    imageUrls.push(media.display_url);
  }

  return {
    code: media.shortcode,
    mediaType: isSidecar ? "carousel" : "image",
    imageUrls,
    caption,
    likeCount,
    commentCount,
    takenAt,
  };
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
  const codeFromUrl = extractCode(postUrl);

  console.log(`Buscando post ${postUrl}...`);
  const raw = await client.getPostRaw(postUrl);

  const profileDir = path.join(OUTPUT_DIR, handle);
  await mkdir(profileDir, { recursive: true });
  const rawDebugPath = path.join(profileDir, `${codeFromUrl}-raw.json`);
  await writeFile(rawDebugPath, JSON.stringify(raw, null, 2));

  const extracted = extractFromGraphQLResponse(raw);
  if (!extracted) {
    console.error(
      `\nNão reconheci o formato da resposta. Confira ${rawDebugPath} e ajuste\n` +
        "extractFromGraphQLResponse() em src/fetch-reference-post.ts."
    );
    process.exitCode = 1;
    return;
  }

  const postDir = path.join(profileDir, extracted.code);
  await mkdir(postDir, { recursive: true });

  const localImages: string[] = [];
  for (let i = 0; i < extracted.imageUrls.length; i++) {
    const fileName = `slide-${String(i + 1).padStart(2, "0")}.jpg`;
    const destPath = path.join(postDir, fileName);
    await downloadImage(extracted.imageUrls[i], destPath);
    localImages.push(path.relative(OUTPUT_DIR, destPath));
    console.log(`  + slide-${i + 1} baixado`);
  }

  if (localImages.length === 0) {
    console.error(`Nenhuma imagem baixada — confira ${rawDebugPath} pra ver se o post tem mídia de imagem.`);
    process.exitCode = 1;
    return;
  }

  const meta: SavedPostMeta = {
    code: extracted.code,
    permalink: postUrl,
    mediaType: extracted.mediaType,
    slideCount: localImages.length,
    caption: extracted.caption,
    likeCount: extracted.likeCount,
    commentCount: extracted.commentCount,
    takenAt: extracted.takenAt,
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
  index.posts = [...index.posts.filter((p) => p.code !== extracted.code), meta];
  await writeFile(indexPath, JSON.stringify(index, null, 2));

  console.log(`\nPronto. Use reference: "${handle}/${extracted.code}" nos specs do render-template.ts.`);
}

main().catch((err) => {
  console.error("Erro fatal:", err);
  process.exitCode = 1;
});
