// Emoji dataset and picker core for @nexussgram/shared
// Curated emoji pack used by channels, reactions, and the emoji picker.

import { EMOJI_CATEGORIES, CURATED_CHANNEL_EMOJIS } from "./constants";

// ============================================
// Emoji Data
// ============================================

/**
 * A single emoji entry.
 */
export interface EmojiEntry {
  emoji: string;
  name: string;
  category: string;
  keywords: string[];
  skinTones: string[] | null;
  version: string;
}

/**
 * A category of emojis.
 */
export interface EmojiCategoryData {
  name: string;
  emojis: EmojiEntry[];
}

/**
 * The default emoji pack shipped with the app.
 */
export interface EmojiPack {
  id: string;
  name: string;
  version: string;
  categories: EmojiCategoryData[];
  isDefault: boolean;
}

// Minimal keyword index for the curated set. Each emoji maps to search terms
// so the picker can surface relevant results without a heavy external dataset.
const EMOJI_KEYWORDS: Record<string, string[]> = {
  "👍": ["thumbs up", "like", "approve", "agree", "yes"],
  "👎": ["thumbs down", "dislike", "disapprove", "no"],
  "❤️": ["heart", "love", "like", "red heart"],
  "🔥": ["fire", "hot", "lit", "amazing"],
  "😁": ["beam", "smile", "happy", "eyes", "grin"],
  "😂": ["laugh", "tears", "joy", "funny", "crying"],
  "😢": ["sad", "cry", "tear", "sorrow"],
  "😮": ["surprise", "shock", "wow", "omg"],
  "😡": ["angry", "mad", "rage", "furious"],
  "🤔": ["thinking", "think", "wonder", "question"],
  "👏": ["clap", "applause", "praise", "congrats"],
  "🙏": ["pray", "please", "thank", "hope"],
  "🎉": ["party", "celebrate", "congrats", "tada"],
  "💯": ["hundred", "perfect", "score", "keep it real"],
  "🤝": ["handshake", "agree", "deal", "partnership"],
  "💪": ["strong", "flex", "power", "workout"],
  "🧠": ["brain", "smart", "think", "intelligent"],
  "👀": ["eyes", "watch", "look", "watching"],
  "💩": ["poop", "crap", "gross", "funny"],
  "🤷": ["shrug", "whatever", "idk", "don't know"],
};

/**
 * Curated emoji set for channel reactions — matches CURATED_CHANNEL_EMOJIS.
 */
export const CURATED_EMOJI_SET: string[] = [...CURATED_CHANNEL_EMOJIS];

/**
 * Build the default emoji pack from the curated set and category list.
 * Emojis not in EMOJI_KEYWORDS get a minimal keyword entry.
 */
export const DEFAULT_EMOJI_PACK: EmojiPack = {
  id: "default",
  name: "Default",
  version: "1.0.0",
  categories: EMOJI_CATEGORIES.map((category) => ({
    name: category,
    emojis: CURATED_CHANNEL_EMOJIS.map((emoji) => ({
      emoji,
      name: emoji,
      category,
      keywords: EMOJI_KEYWORDS[emoji] ?? [emoji],
      skinTones: null,
      version: "1.0.0",
    })),
  })),
  isDefault: true,
};

// ============================================
// Helpers
// ============================================

/**
 * Flatten all emojis from a pack into a single list.
 */
export function flattenEmojis(pack: EmojiPack): EmojiEntry[] {
  return pack.categories.flatMap((cat) => cat.emojis);
}

/**
 * Search emojis by keyword across all categories.
 * Matches against the emoji character, name, and keywords.
 */
export function searchEmojis(pack: EmojiPack, query: string): EmojiEntry[] {
  const q = query.toLowerCase().trim();
  if (!q) return flattenEmojis(pack);

  return flattenEmojis(pack).filter((entry) => {
    const haystack = [entry.emoji, entry.name, ...entry.keywords].join(" ").toLowerCase();
    return haystack.includes(q);
  });
}

/**
 * Get emojis for a specific category.
 */
export function getEmojisByCategory(pack: EmojiPack, category: string): EmojiEntry[] {
  const cat = pack.categories.find((c) => c.name === category);
  return cat ? cat.emojis : [];
}

/**
 * Check whether an emoji is part of the curated channel reaction set.
 */
export function isCuratedEmoji(emoji: string): boolean {
  return CURATED_EMOJI_SET.includes(emoji);
}

// (Types and constants are already exported at declaration)
