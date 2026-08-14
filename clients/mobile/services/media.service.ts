export type MediaType =
  | "IMAGE"
  | "VIDEO"
  | "VOICE_NOTE"
  | "DOCUMENT"
  | "LINK"
  | "FILE";

export type MediaItem = {
  id: string;
  mediaType: MediaType;
  title: string;
  starred: boolean;
  createdAt: string;
};

export class MediaService {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly getAccessToken: () => Promise<string>,
  ) {}

  async list(mediaType?: MediaType): Promise<MediaItem[]> {
    const token = await this.getAccessToken();
    const query = mediaType ? `?mediaType=${mediaType}` : "";

    const response = await fetch(`${this.apiBaseUrl}/v1/media${query}`, {
      headers: { authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error(`Unable to load media (${response.status}).`);
    }

    const payload = await response.json();

    return (payload.media ?? []).map((item: any) => ({
      id: item.id,
      mediaType: item.media_type,
      title: item.title ?? item.media_type,
      starred: item.starred === true,
      createdAt: item.created_at,
    }));
  }
}
