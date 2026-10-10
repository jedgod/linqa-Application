export type SkinTone = 0 | 1 | 2 | 3 | 4 | 5;

export const SKIN_TONES: { id: SkinTone; swatch: string; modifier: string }[] = [
  { id: 0, swatch: "#FFCC4D", modifier: "" },
  { id: 1, swatch: "#FFDCB1", modifier: "\u{1F3FB}" },
  { id: 2, swatch: "#E6BC98", modifier: "\u{1F3FC}" },
  { id: 3, swatch: "#D4A276", modifier: "\u{1F3FD}" },
  { id: 4, swatch: "#A06A42", modifier: "\u{1F3FE}" },
  { id: 5, swatch: "#6B4423", modifier: "\u{1F3FF}" },
];

export type EmojiItem = {
  emoji: string;
  name: string;
  tonable?: boolean;
};

export type EmojiCategory = {
  id: string;
  label: string;
  icon: string;
  items: EmojiItem[];
};

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: "recent",
    label: "Recently used",
    icon: "clock",
    items: [
      { emoji: "😂", name: "face with tears of joy" },
      { emoji: "❤️", name: "red heart" },
      { emoji: "🙏", name: "folded hands", tonable: true },
      { emoji: "😍", name: "smiling face with heart-eyes" },
      { emoji: "👍", name: "thumbs up", tonable: true },
      { emoji: "🎉", name: "party popper" },
    ],
  },
  {
    id: "smileys",
    label: "Smileys and people",
    icon: "smile",
    items: [
      { emoji: "😀", name: "grinning face" },
      { emoji: "😃", name: "grinning face with big eyes" },
      { emoji: "😄", name: "grinning face with smiling eyes" },
      { emoji: "😁", name: "beaming face with smiling eyes" },
      { emoji: "😆", name: "grinning squinting face" },
      { emoji: "😅", name: "grinning face with sweat" },
      { emoji: "🤣", name: "rolling on the floor laughing" },
      { emoji: "😂", name: "face with tears of joy" },
      { emoji: "🙂", name: "slightly smiling face" },
      { emoji: "😉", name: "winking face" },
      { emoji: "😊", name: "smiling face with smiling eyes" },
      { emoji: "😍", name: "smiling face with heart-eyes" },
      { emoji: "😘", name: "face blowing a kiss" },
      { emoji: "😎", name: "smiling face with sunglasses" },
      { emoji: "🤔", name: "thinking face" },
      { emoji: "😴", name: "sleeping face" },
      { emoji: "😭", name: "loudly crying face" },
      { emoji: "😡", name: "pouting face" },
      { emoji: "👋", name: "waving hand", tonable: true },
      { emoji: "🙏", name: "folded hands", tonable: true },
      { emoji: "👍", name: "thumbs up", tonable: true },
      { emoji: "👎", name: "thumbs down", tonable: true },
      { emoji: "👏", name: "clapping hands", tonable: true },
      { emoji: "💪", name: "flexed biceps", tonable: true },
      { emoji: "🤝", name: "handshake" },
      { emoji: "👀", name: "eyes" },
    ],
  },
  {
    id: "animals",
    label: "Animals and nature",
    icon: "bear",
    items: [
      { emoji: "🐶", name: "dog face" },
      { emoji: "🐱", name: "cat face" },
      { emoji: "🐻", name: "bear" },
      { emoji: "🐼", name: "panda" },
      { emoji: "🦁", name: "lion" },
      { emoji: "🐸", name: "frog" },
      { emoji: "🌸", name: "cherry blossom" },
      { emoji: "🌿", name: "herb" },
      { emoji: "🔥", name: "fire" },
      { emoji: "⭐", name: "star" },
    ],
  },
  {
    id: "food",
    label: "Food and drink",
    icon: "food",
    items: [
      { emoji: "🍔", name: "hamburger" },
      { emoji: "🍕", name: "pizza" },
      { emoji: "☕", name: "hot beverage" },
      { emoji: "🍰", name: "shortcake" },
      { emoji: "🍎", name: "red apple" },
      { emoji: "🥑", name: "avocado" },
    ],
  },
  {
    id: "activity",
    label: "Activities",
    icon: "ball",
    items: [
      { emoji: "⚽", name: "soccer ball" },
      { emoji: "🏀", name: "basketball" },
      { emoji: "🎮", name: "video game" },
      { emoji: "🏆", name: "trophy" },
      { emoji: "🎯", name: "bullseye" },
    ],
  },
  {
    id: "travel",
    label: "Travel and places",
    icon: "plane",
    items: [
      { emoji: "✈️", name: "airplane" },
      { emoji: "🚗", name: "automobile" },
      { emoji: "🏠", name: "house" },
      { emoji: "🌍", name: "globe showing Europe-Africa" },
      { emoji: "🗺️", name: "world map" },
    ],
  },
  {
    id: "objects",
    label: "Objects",
    icon: "bulb",
    items: [
      { emoji: "💡", name: "light bulb" },
      { emoji: "📱", name: "mobile phone" },
      { emoji: "💻", name: "laptop" },
      { emoji: "📷", name: "camera" },
      { emoji: "📎", name: "paperclip" },
    ],
  },
  {
    id: "symbols",
    label: "Symbols",
    icon: "symbols",
    items: [
      { emoji: "❤️", name: "red heart" },
      { emoji: "💛", name: "yellow heart" },
      { emoji: "💜", name: "purple heart" },
      { emoji: "💯", name: "hundred points" },
      { emoji: "✅", name: "check mark button" },
      { emoji: "❗", name: "exclamation mark" },
      { emoji: "❓", name: "question mark" },
    ],
  },
  {
    id: "flags",
    label: "Flags",
    icon: "flag",
    items: [
      { emoji: "🇺🇸", name: "flag: United States" },
      { emoji: "🇬🇧", name: "flag: United Kingdom" },
      { emoji: "🇬🇭", name: "flag: Ghana" },
      { emoji: "🇳🇬", name: "flag: Nigeria" },
      { emoji: "🇨🇦", name: "flag: Canada" },
      { emoji: "🇫🇷", name: "flag: France" },
    ],
  },
];

export type Sticker = {
  id: string;
  label: string;
  emoji?: string;
  tone?: string;
  image?: string;
};

export const STICKER_PACKS = [
  { id: "recent", label: "Recent", kind: "recent" as const },
  { id: "favorites", label: "Favorites", kind: "star" as const },
  { id: "add", label: "Add pack", kind: "add" as const },
  { id: "coffee", label: "Coffee", emoji: "☕" },
  { id: "bloom", label: "Bloom", emoji: "🌸" },
  { id: "jm", label: "JM", emoji: "JM" },
];

export const RECENT_STICKERS: Sticker[] = [
  { id: "coffee", label: "Coffee", emoji: "☕" },
  { id: "pray", label: "Prayer", emoji: "🙏" },
  { id: "party", label: "Party", emoji: "🎉" },
  { id: "heart", label: "Heart", emoji: "❤️" },
  { id: "thumb", label: "Thumbs up", emoji: "👍" },
];

export const FAVORITE_STICKERS: Sticker[] = [
  { id: "heart", label: "Heart", emoji: "❤️" },
  { id: "pray", label: "Prayer", emoji: "🙏" },
  { id: "party", label: "Party", emoji: "🎉" },
  { id: "coffee", label: "Coffee", emoji: "☕" },
  { id: "thumb", label: "Thumbs up", emoji: "👍" },
];

export const GIF_CHIPS = [
  "Trending",
  "Reactions",
  "Celebrate",
  "Love",
  "Sports",
  "Animals",
  "TV",
] as const;

export type GifTile = {
  id: string;
  title: string;
  tint: string;
  emoji: string;
};

export const TRENDING_GIFS: GifTile[] = [
  { id: "laugh", title: "Laughing", tint: "#F6D7C3", emoji: "😄" },
  { id: "thumb", title: "Thumbs up", tint: "#6D4AFF", emoji: "👍" },
  { id: "party", title: "Party", tint: "#7B3FE4", emoji: "🎉" },
  { id: "heart", title: "Heart burst", tint: "#FFE4EC", emoji: "💖" },
  { id: "clap", title: "Clapping", tint: "#F3D7C4", emoji: "👏" },
  { id: "dance", title: "Dance", tint: "#5B34C6", emoji: "💃" },
];

export const REACTION_GIFS: GifTile[] = [
  { id: "joy", title: "Joy", tint: "#FFF4CC", emoji: "😂" },
  { id: "love", title: "Love", tint: "#FFE8EE", emoji: "❤️" },
  { id: "hands", title: "Heart hands", tint: "#FFF0F5", emoji: "🫶" },
  { id: "pop", title: "Popper", tint: "#F4EEFF", emoji: "🎉" },
  { id: "wow", title: "Wow", tint: "#FFF6D8", emoji: "😮" },
  { id: "blush", title: "Blush", tint: "#FFF0E8", emoji: "😊" },
  { id: "fire", title: "Fire", tint: "#FFF1E6", emoji: "🔥" },
];

export function applySkinTone(emoji: string, tone: SkinTone) {
  const modifier = SKIN_TONES[tone]?.modifier ?? "";
  if (!modifier) return emoji;
  return emoji + modifier;
}

export function filterEmoji(query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return EMOJI_CATEGORIES;
  return EMOJI_CATEGORIES.map((category) => ({
    ...category,
    items: category.items.filter(
      (item) => item.name.includes(q) || item.emoji.includes(q),
    ),
  })).filter((category) => category.items.length > 0);
}
