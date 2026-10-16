const BASE_URL = "https://api.scrapecreators.com";

export interface InstagramImageCandidate {
  url: string;
  width: number;
  height: number;
}

export interface InstagramCarouselItem {
  id?: string;
  media_type: number;
  image_versions2?: { candidates: InstagramImageCandidate[] };
}

export interface InstagramPost {
  id?: string;
  pk?: string;
  code: string; // shortcode, usado para montar o link do post
  media_type: number; // 1 = imagem única, 2 = vídeo, 8 = carrossel
  caption?: { text: string } | null;
  like_count?: number;
  comment_count?: number;
  taken_at?: number;
  image_versions2?: { candidates: InstagramImageCandidate[] };
  carousel_media?: InstagramCarouselItem[];
}

export interface InstagramUserPostsResponse {
  items: InstagramPost[];
  num_results?: number;
  more_available?: boolean;
  next_max_id?: string;
}

export class ScrapeCreatorsClient {
  constructor(private readonly apiKey: string) {
    if (!apiKey) {
      throw new Error("SCRAPECREATORS_API_KEY não definido no .env");
    }
  }

  private async request<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = new URL(path, BASE_URL);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") url.searchParams.set(key, value);
    }

    const response = await fetch(url, {
      headers: { "x-api-key": this.apiKey },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `ScrapeCreators ${response.status} em ${path}: ${body.slice(0, 300)}`
      );
    }

    return (await response.json()) as T;
  }

  /** Busca uma página de posts recentes de um perfil público do Instagram. */
  async getUserPosts(handle: string, nextMaxId?: string): Promise<InstagramUserPostsResponse> {
    return this.request<InstagramUserPostsResponse>("/v2/instagram/user/posts", {
      handle,
      next_max_id: nextMaxId ?? "",
    });
  }

  /**
   * Busca um post específico pela URL do Instagram.
   * A forma exata da resposta não é documentada publicamente — retorna o
   * JSON bruto; quem chama precisa extrair o post de forma defensiva
   * (ver resolvePostFromRawResponse em fetch-reference-post.ts).
   */
  async getPostRaw(postUrl: string): Promise<unknown> {
    return this.request<unknown>("/v1/instagram/post", { url: postUrl });
  }
}
