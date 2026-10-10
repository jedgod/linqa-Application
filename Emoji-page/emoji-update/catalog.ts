export type SkinTone = 0 | 1 | 2 | 3 | 4 | 5;

export type EmojiItem = {
  char: string;
  name: string;
  tonable?: boolean;
};

export type EmojiCategory = {
  id: string;
  label: string;
  items: EmojiItem[];
};

export type Sticker = {
  id: string;
  label: string;
  emoji: string;
};

export type ExpressionPrefs = {
  version: 1;
  recent: string[];
  tones: Partial<Record<string, SkinTone>>;
  defaultTone: SkinTone;
  favoriteIds: string[];
};

export const EMPTY_PREFS: ExpressionPrefs = {
  version: 1,
  recent: ["😂", "❤️", "🙏", "😍", "👍", "🎉"],
  tones: {},
  defaultTone: 0,
  favoriteIds: [],
};

export const SKIN_TONES: { id: SkinTone; swatch: string; modifier: string; label: string }[] = [
  { id: 0, swatch: "#FFCC4D", modifier: "", label: "Default skin tone" },
  { id: 1, swatch: "#FFDCB1", modifier: "\u{1F3FB}", label: "Light skin tone" },
  { id: 2, swatch: "#E6BC98", modifier: "\u{1F3FC}", label: "Medium-light skin tone" },
  { id: 3, swatch: "#D4A276", modifier: "\u{1F3FD}", label: "Medium skin tone" },
  { id: 4, swatch: "#A06A42", modifier: "\u{1F3FE}", label: "Medium-dark skin tone" },
  { id: 5, swatch: "#6B4423", modifier: "\u{1F3FF}", label: "Dark skin tone" },
];

export function applyTone(emoji: string, tone: SkinTone) {
  const modifier = SKIN_TONES[tone]?.modifier ?? "";
  return modifier ? emoji + modifier : emoji;
}

export const CATEGORIES: EmojiCategory[] = [
  {
    id: "smileys",
    label: "Smileys and people",
    items: [
      { char: "😀", name: "grinning face" },
      { char: "😃", name: "grinning face with big eyes" },
      { char: "😄", name: "grinning face with smiling eyes" },
      { char: "😁", name: "beaming face" },
      { char: "😆", name: "grinning squinting face" },
      { char: "😅", name: "grinning face with sweat" },
      { char: "🤣", name: "rolling on the floor laughing" },
      { char: "😂", name: "face with tears of joy" },
      { char: "🙂", name: "slightly smiling face" },
      { char: "😉", name: "winking face" },
      { char: "😊", name: "smiling face with smiling eyes" },
      { char: "😇", name: "smiling face with halo" },
      { char: "😍", name: "smiling face with heart eyes" },
      { char: "😘", name: "face blowing a kiss" },
      { char: "😗", name: "kissing face" },
      { char: "😋", name: "face savoring food" },
      { char: "😛", name: "face with tongue" },
      { char: "😜", name: "winking face with tongue" },
      { char: "🤪", name: "zany face" },
      { char: "😎", name: "smiling face with sunglasses" },
      { char: "🤓", name: "nerd face" },
      { char: "🧐", name: "face with monocle" },
      { char: "😏", name: "smirking face" },
      { char: "😒", name: "unamused face" },
      { char: "😞", name: "disappointed face" },
      { char: "😔", name: "pensive face" },
      { char: "😟", name: "worried face" },
      { char: "😕", name: "confused face" },
      { char: "🙁", name: "slightly frowning face" },
      { char: "☹️", name: "frowning face" },
      { char: "😣", name: "persevering face" },
      { char: "😖", name: "confounded face" },
      { char: "😫", name: "tired face" },
      { char: "😩", name: "weary face" },
      { char: "🥺", name: "pleading face" },
      { char: "😢", name: "crying face" },
      { char: "😭", name: "loudly crying face" },
      { char: "😤", name: "face with steam from nose" },
      { char: "😠", name: "angry face" },
      { char: "😡", name: "pouting face" },
      { char: "🤯", name: "exploding head" },
      { char: "😳", name: "flushed face" },
      { char: "🤗", name: "hugging face" },
      { char: "🤔", name: "thinking face" },
      { char: "🤭", name: "face with hand over mouth" },
      { char: "🤫", name: "shushing face" },
      { char: "🤥", name: "lying face" },
      { char: "😶", name: "face without mouth" },
      { char: "😐", name: "neutral face" },
      { char: "😑", name: "expressionless face" },
      { char: "😬", name: "grimacing face" },
      { char: "🙄", name: "face with rolling eyes" },
      { char: "😯", name: "hushed face" },
      { char: "😦", name: "frowning face with open mouth" },
      { char: "😧", name: "anguished face" },
      { char: "😮", name: "face with open mouth" },
      { char: "😲", name: "astonished face" },
      { char: "🥱", name: "yawning face" },
      { char: "😴", name: "sleeping face" },
      { char: "🤤", name: "drooling face" },
      { char: "😪", name: "sleepy face" },
      { char: "😵", name: "dizzy face" },
      { char: "🤧", name: "sneezing face" },
      { char: "🤒", name: "face with thermometer" },
      { char: "🤕", name: "face with head bandage" },
      { char: "🤢", name: "nauseated face" },
      { char: "🤮", name: "face vomiting" },
      { char: "🤠", name: "cowboy hat face" },
      { char: "🥳", name: "partying face" },
      { char: "😎", name: "sunglasses" },
      { char: "👋", name: "waving hand", tonable: true },
      { char: "🤚", name: "raised back of hand", tonable: true },
      { char: "✋", name: "raised hand", tonable: true },
      { char: "👌", name: "ok hand", tonable: true },
      { char: "✌️", name: "victory hand", tonable: true },
      { char: "🤞", name: "crossed fingers", tonable: true },
      { char: "🤟", name: "love you gesture", tonable: true },
      { char: "🤘", name: "sign of the horns", tonable: true },
      { char: "👍", name: "thumbs up", tonable: true },
      { char: "👎", name: "thumbs down", tonable: true },
      { char: "✊", name: "raised fist", tonable: true },
      { char: "👊", name: "oncoming fist", tonable: true },
      { char: "👏", name: "clapping hands", tonable: true },
      { char: "🙌", name: "raising hands", tonable: true },
      { char: "👐", name: "open hands", tonable: true },
      { char: "🤲", name: "palms up together", tonable: true },
      { char: "🙏", name: "folded hands", tonable: true },
      { char: "💪", name: "flexed biceps", tonable: true },
      { char: "👀", name: "eyes" },
      { char: "🧠", name: "brain" },
    ],
  },
  {
    id: "hearts",
    label: "Hearts",
    items: [
      { char: "❤️", name: "red heart" },
      { char: "🧡", name: "orange heart" },
      { char: "💛", name: "yellow heart" },
      { char: "💚", name: "green heart" },
      { char: "💙", name: "blue heart" },
      { char: "💜", name: "purple heart" },
      { char: "🖤", name: "black heart" },
      { char: "🤍", name: "white heart" },
      { char: "💔", name: "broken heart" },
      { char: "❣️", name: "heart exclamation" },
      { char: "💕", name: "two hearts" },
      { char: "💞", name: "revolving hearts" },
      { char: "💓", name: "beating heart" },
      { char: "💗", name: "growing heart" },
      { char: "💖", name: "sparkling heart" },
      { char: "💘", name: "heart with arrow" },
    ],
  },
  {
    id: "nature",
    label: "Animals and nature",
    items: [
      { char: "🐶", name: "dog" },
      { char: "🐱", name: "cat" },
      { char: "🐭", name: "mouse" },
      { char: "🐹", name: "hamster" },
      { char: "🐰", name: "rabbit" },
      { char: "🦊", name: "fox" },
      { char: "🐻", name: "bear" },
      { char: "🐼", name: "panda" },
      { char: "🐨", name: "koala" },
      { char: "🐯", name: "tiger" },
      { char: "🦁", name: "lion" },
      { char: "🐮", name: "cow" },
      { char: "🐷", name: "pig" },
      { char: "🐸", name: "frog" },
      { char: "🐵", name: "monkey" },
      { char: "🐔", name: "chicken" },
      { char: "🐧", name: "penguin" },
      { char: "🐦", name: "bird" },
      { char: "🌸", name: "cherry blossom" },
      { char: "🌹", name: "rose" },
      { char: "🌺", name: "hibiscus" },
      { char: "🌻", name: "sunflower" },
      { char: "🌼", name: "blossom" },
      { char: "🌿", name: "herb" },
      { char: "🍀", name: "four leaf clover" },
      { char: "🔥", name: "fire" },
      { char: "⭐", name: "star" },
      { char: "🌟", name: "glowing star" },
      { char: "✨", name: "sparkles" },
      { char: "🌈", name: "rainbow" },
    ],
  },
  {
    id: "food",
    label: "Food and drink",
    items: [
      { char: "🍏", name: "green apple" },
      { char: "🍎", name: "red apple" },
      { char: "🍔", name: "hamburger" },
      { char: "🍟", name: "french fries" },
      { char: "🍕", name: "pizza" },
      { char: "🌭", name: "hot dog" },
      { char: "🥪", name: "sandwich" },
      { char: "🌮", name: "taco" },
      { char: "🍣", name: "sushi" },
      { char: "🍦", name: "ice cream" },
      { char: "🍩", name: "doughnut" },
      { char: "🍪", name: "cookie" },
      { char: "🎂", name: "birthday cake" },
      { char: "🍰", name: "cake" },
      { char: "☕", name: "coffee" },
      { char: "🍵", name: "tea" },
      { char: "🥤", name: "cup with straw" },
      { char: "🍺", name: "beer" },
    ],
  },
  {
    id: "activity",
    label: "Activities",
    items: [
      { char: "⚽", name: "soccer ball" },
      { char: "🏀", name: "basketball" },
      { char: "🏈", name: "american football" },
      { char: "⚾", name: "baseball" },
      { char: "🎾", name: "tennis" },
      { char: "🏐", name: "volleyball" },
      { char: "🎮", name: "video game" },
      { char: "🏆", name: "trophy" },
      { char: "🎯", name: "direct hit" },
      { char: "🎲", name: "game die" },
    ],
  },
  {
    id: "travel",
    label: "Travel and places",
    items: [
      { char: "🚗", name: "car" },
      { char: "🚕", name: "taxi" },
      { char: "🚌", name: "bus" },
      { char: "✈️", name: "airplane" },
      { char: "🚀", name: "rocket" },
      { char: "🏠", name: "house" },
      { char: "🏢", name: "office" },
      { char: "🌍", name: "globe" },
      { char: "🗺️", name: "world map" },
    ],
  },
  {
    id: "objects",
    label: "Objects",
    items: [
      { char: "💡", name: "light bulb" },
      { char: "📱", name: "mobile phone" },
      { char: "💻", name: "laptop" },
      { char: "📷", name: "camera" },
      { char: "📎", name: "paperclip" },
      { char: "📌", name: "pushpin" },
      { char: "🔑", name: "key" },
      { char: "🔒", name: "locked" },
      { char: "🔔", name: "bell" },
      { char: "📦", name: "package" },
    ],
  },
  {
    id: "symbols",
    label: "Symbols",
    items: [
      { char: "💯", name: "hundred points" },
      { char: "✅", name: "check mark" },
      { char: "❌", name: "cross mark" },
      { char: "❓", name: "question mark" },
      { char: "❗", name: "exclamation mark" },
      { char: "💤", name: "zzz" },
      { char: "💬", name: "speech balloon" },
      { char: "🔔", name: "bell" },
    ],
  },
  {
    id: "flags",
    label: "Flags",
    items: [
      { char: "🇺🇸", name: "united states" },
      { char: "🇬🇧", name: "united kingdom" },
      { char: "🇬🇭", name: "ghana" },
      { char: "🇳🇬", name: "nigeria" },
      { char: "🇨🇦", name: "canada" },
      { char: "🇫🇷", name: "france" },
      { char: "🇩🇪", name: "germany" },
      { char: "🇯🇵", name: "japan" },
      { char: "🇧🇷", name: "brazil" },
      { char: "🇮🇳", name: "india" },
    ],
  },
];

export const STICKERS: Sticker[] = [
  { id: "joy", label: "Joy", emoji: "😂" },
  { id: "heart", label: "Heart", emoji: "❤️" },
  { id: "pray", label: "Prayer", emoji: "🙏" },
  { id: "love", label: "Heart eyes", emoji: "😍" },
  { id: "thumb", label: "Thumbs up", emoji: "👍" },
  { id: "party", label: "Party", emoji: "🎉" },
  { id: "fire", label: "Fire", emoji: "🔥" },
  { id: "clap", label: "Clap", emoji: "👏" },
  { id: "coffee", label: "Coffee", emoji: "☕" },
  { id: "star", label: "Star", emoji: "⭐" },
];

export function searchCategories(query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return CATEGORIES;
  return CATEGORIES.map((category) => ({
    ...category,
    items: category.items.filter((item) => item.name.includes(q) || item.char.includes(q)),
  })).filter((category) => category.items.length > 0);
}
