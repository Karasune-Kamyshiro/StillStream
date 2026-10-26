import type {
  ChatLayout,
  ChatOverlayOpacity,
  ChatOverlayPosition,
  ChatOverlaySize,
  ChatTextSize,
  ChatTheme,
  PreferencesSnapshot,
} from "../../shared/contracts"

export type ChatAppearance = {
  readonly layout: ChatLayout
  readonly opacity: ChatOverlayOpacity
  readonly position: ChatOverlayPosition
  readonly size: ChatOverlaySize
  readonly textSize: ChatTextSize
  readonly theme: ChatTheme
}

export const DEFAULT_CHAT_APPEARANCE: ChatAppearance = {
  layout: "beside",
  opacity: "85",
  position: "right",
  size: "medium",
  textSize: "normal",
  theme: "dark",
}

export const chatAppearance = (preferences: PreferencesSnapshot): ChatAppearance => ({
  layout: preferences.chatLayout,
  opacity: preferences.chatOverlayOpacity,
  position: preferences.chatOverlayPosition,
  size: preferences.chatOverlaySize,
  textSize: preferences.chatTextSize,
  theme: preferences.chatTheme,
})

/** Multiplies the chat's existing TV scale; "normal" keeps today's size. */
export const CHAT_TEXT_SCALE: Readonly<Record<ChatTextSize, number>> = {
  large: 1.25,
  normal: 1,
  small: 0.8,
  xlarge: 1.5,
}

export const CHAT_OVERLAY_LABELS = {
  opacity: { "50": "50%", "70": "70%", "85": "85%", "100": "Opaque" },
  position: {
    "bottom-left": "Bottom left",
    "bottom-right": "Bottom right",
    left: "Left",
    right: "Right",
    "top-left": "Top left",
    "top-right": "Top right",
  },
  size: { large: "Large", medium: "Medium", small: "Small" },
  textSize: { large: "Large", normal: "Normal", small: "Small", xlarge: "Extra large" },
} as const satisfies {
  readonly opacity: Record<ChatOverlayOpacity, string>
  readonly position: Record<ChatOverlayPosition, string>
  readonly size: Record<ChatOverlaySize, string>
  readonly textSize: Record<ChatTextSize, string>
}

/** The option after `current`, wrapping: remote-friendly cycling through a short list. */
export const nextOption = <Option extends string>(
  options: readonly Option[],
  current: Option,
): Option => options[(options.indexOf(current) + 1) % options.length] ?? current
