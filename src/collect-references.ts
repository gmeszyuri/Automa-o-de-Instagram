import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ScrapeCreatorsClient, type InstagramPost } from "./lib/scrapeCreators.js";
import competitors from "../config/competitors.json" with { type: "json" };

const MAX_POSTS_PER_PROFILE = 12;
const OUTPUT_DIR = path.resolve("references");
const REQUEST_DELAY_MS = 600;

const MEDIA_TYPE_IMAGE = 1;
const MEDIA_TYPE_VIDEO = 2;
const MEDIA_TYPE_CAROUSEL = 8;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isImageOrCarousel(post: InstagramPost): boolean {
  return post.media_type === MEDIA_TYPE_IMAGE || post.media_type === MEDIA_TYPE_CAROUSEL;
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

async function collectProfile(client: ScrapeCreatorsClient, handle: string): Promise<SavedPostMeta[]> {
  const profileDir = path.join(OUTPUT_DIR, handle);
  await mkdir(profileDir, { recursive: true });

  const collected: SavedPostMeta[] = [];
  let nextMaxId: string | undefined;

  while (collected.length < MAX_POSTS_PER_PROFILE) {
    const page = await client.getUserPosts(handle, nextMaxId);
    const posts = page.items ?? [];

    for (const post of posts) {
      if (collected.length >= MAX_POSTS_PER_PROFILE) break;
      if (!isImageOrCarousel(post)) continue; // ignora vídeos/reels

      const postDir = path.join(profileDir, post.code);
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
        try {
          await downloadImage(imageUrl, destPath);
          localImages.push(path.relative(OUTPUT_DIR, destPath));
        } catch (err) {
          console.warn(`  ! Falha ao baixar slide ${i + 1} do post ${post.code}:`, (err as Error).message);
        }
      }

      if (localImages.length === 0) continue;

      const meta: SavedPostMeta = {
        code: post.code,
        permalink: `https://www.instagram.com/p/${post.code}/`,
        mediaType: post.media_type === MEDIA_TYPE_CAROUSEL ? "carousel" : "image",
        slideCount: localImages.length,
        caption: post.caption?.text ?? "",
        likeCount: post.like_count,
        commentCount: post.comment_count,
        takenAt: post.taken_at ? new Date(post.taken_at * 1000).toISOString() : undefined,
        localImages,
      };

      await writeFile(path.join(postDir, "meta.json"), JSON.stringify(meta, null, 2));
      collected.push(meta);
      console.log(`  + @${handle} post ${post.code} (${meta.mediaType}, ${meta.slideCount} slide(s))`);
    }

    if (!page.more_available || !page.next_max_id || collected.length >= MAX_POSTS_PER_PROFILE) break;
    nextMaxId = page.next_max_id;
    await sleep(REQUEST_DELAY_MS);
  }

  await writeFile(
    path.join(profileDir, "index.json"),
    JSON.stringify({ handle, collectedAt: new Date().toISOString(), posts: collected }, null, 2)
  );

  return collected;
}

async function main() {
  const apiKey = process.env.SCRAPECREATORS_API_KEY ?? "";
  const client = new ScrapeCreatorsClient(apiKey);

  await mkdir(OUTPUT_DIR, { recursive: true });

  // Uso: npm run collect-references -- acertcertisign
  // Sem argumento, coleta todos os perfis de config/competitors.json.
  const filterHandle = process.argv[2];
  const profiles = filterHandle
    ? competitors.profiles.filter((p) => p.handle === filterHandle)
    : competitors.profiles;

  if (filterHandle && profiles.length === 0) {
    console.error(`Perfil "${filterHandle}" não encontrado em config/competitors.json`);
    process.exitCode = 1;
    return;
  }

  const summary: Record<string, number> = {};

  for (const { handle } of profiles) {
    console.log(`\nColetando referências de @${handle}...`);
    try {
      const posts = await collectProfile(client, handle);
      summary[handle] = posts.length;
    } catch (err) {
      console.error(`Erro ao coletar @${handle}:`, (err as Error).message);
      summary[handle] = 0;
    }
    await sleep(REQUEST_DELAY_MS);
  }

  console.log("\nResumo da coleta:");
  for (const [handle, count] of Object.entries(summary)) {
    console.log(`  @${handle}: ${count} post(s) salvos`);
  }
}

main().catch((err) => {
  console.error("Erro fatal:", err);
  process.exitCode = 1;
});
