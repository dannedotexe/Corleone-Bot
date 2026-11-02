/**
 * Eigene Yamamoto-Emojis (dunkle Kachel mit Goldrand). Unicode-Emoji → Bot-Emoji-Name, Icon (Lucide) und Farbe.
 * Die Bilder liegen in assets/emojis/<name>.png (erzeugt mit scripts/build-emojis.mjs).
 */
const GREEN = "#34d399", RED = "#f87171", AMBER = "#fbbf24";
export const EMOJI_SET = {
  "✅": ["ym_check", "check", GREEN], "☑️": ["ym_check_box", "square-check", GREEN], "👍": ["ym_thumbs_up", "thumbs-up", GREEN],
  "❌": ["ym_x", "x", RED], "✖️": ["ym_x", "x", RED], "👎": ["ym_thumbs_down", "thumbs-down", RED],
  "🚫": ["ym_ban", "ban", RED], "⛔": ["ym_stop", "octagon-x", RED], "🚩": ["ym_flag_red", "flag", RED], "🚨": ["ym_siren", "siren", RED],
  "⚠️": ["ym_warning", "triangle-alert", AMBER],
  "📅": ["ym_calendar", "calendar-days"], "📆": ["ym_calendar", "calendar-days"], "🗓️": ["ym_calendar_range", "calendar-range"],
  "⏳": ["ym_hourglass", "hourglass"], "⏱️": ["ym_timer", "timer"], "⏰": ["ym_alarm", "alarm-clock"], "🕒": ["ym_clock", "clock-3"], "🕓": ["ym_clock", "clock-3"],
  "🎉": ["ym_party", "party-popper"], "🎫": ["ym_ticket", "ticket"], "🎟️": ["ym_ticket", "ticket"], "🏆": ["ym_trophy", "trophy"],
  "💰": ["ym_wallet", "wallet"], "💸": ["ym_payout", "banknote-arrow-up"], "💵": ["ym_banknote", "banknote"], "🏦": ["ym_bank", "landmark"], "💎": ["ym_gem", "gem"],
  "↩️": ["ym_undo", "undo-2"], "📸": ["ym_camera", "camera"], "⚖️": ["ym_scale", "scale"], "🤝": ["ym_handshake", "handshake"],
  "📋": ["ym_clipboard", "clipboard-list"], "📝": ["ym_note", "notebook-pen"], "✍️": ["ym_pen", "pen-line"], "✏️": ["ym_pencil", "pencil"],
  "📊": ["ym_chart", "chart-column"], "📈": ["ym_trend", "trending-up"], "📨": ["ym_mail", "mail"], "🏅": ["ym_medal", "medal"],
  "🥇": ["ym_medal_gold", "medal", "#f5c542"], "🥈": ["ym_medal_silver", "medal", "#d1d5db"], "🥉": ["ym_medal_bronze", "medal", "#d08a4f"],
  "🧾": ["ym_receipt", "receipt-text"], "🛡️": ["ym_shield", "shield"], "🙋": ["ym_hand", "hand"], "👋": ["ym_wave", "hand"],
  "🔒": ["ym_lock", "lock"], "🔓": ["ym_unlock", "lock-open"], "🔑": ["ym_key", "key-round"],
  "👤": ["ym_user", "user"], "👥": ["ym_users", "users"], "👔": ["ym_briefcase", "briefcase"], "👕": ["ym_shirt", "shirt"], "👢": ["ym_footprints", "footprints"],
  "🏁": ["ym_flag", "flag"], "➖": ["ym_minus", "minus"], "➕": ["ym_plus", "plus"], "💬": ["ym_chat", "message-circle"],
  "🔎": ["ym_search", "search"], "🔍": ["ym_search", "search"], "🛠️": ["ym_tools", "wrench"], "🔧": ["ym_tools", "wrench"], "🧰": ["ym_toolbox", "toolbox"], "⚙️": ["ym_settings", "settings"],
  "🎯": ["ym_target", "target"], "🗳️": ["ym_vote", "vote"], "🧭": ["ym_compass", "compass"], "📌": ["ym_pin", "pin"], "📍": ["ym_location", "map-pin"],
  "💡": ["ym_idea", "lightbulb"], "🔥": ["ym_flame", "flame"], "👑": ["ym_crown", "crown"], "📢": ["ym_megaphone", "megaphone"], "📣": ["ym_megaphone", "megaphone"],
  "🔇": ["ym_mute", "volume-x"], "🔊": ["ym_sound", "volume-2"], "🔄": ["ym_refresh", "refresh-cw"], "🔁": ["ym_repeat", "repeat"],
  "📚": ["ym_book", "book-open"], "📄": ["ym_file", "file-text"], "📂": ["ym_folder", "folder-open"], "🗂️": ["ym_folders", "folders"], "📒": ["ym_notebook", "notebook"], "📜": ["ym_scroll", "scroll-text"],
  "⭐": ["ym_star", "star"], "🎁": ["ym_gift", "gift"], "🌐": ["ym_globe", "globe"], "🏓": ["ym_activity", "activity"], "🏷️": ["ym_tag", "tag"], "📲": ["ym_phone", "smartphone"],
  "🆕": ["ym_new", "sparkles"], "🔮": ["ym_magic", "wand-sparkles"], "☁️": ["ym_cloud", "cloud"], "☀️": ["ym_sun", "sun"], "🌊": ["ym_waves", "waves"], "🌿": ["ym_leaf", "leaf"], "🌱": ["ym_sprout", "sprout"],
  "🛒": ["ym_cart", "shopping-cart"], "🆘": ["ym_help", "life-buoy"], "➡️": ["ym_arrow", "arrow-right"], "🔔": ["ym_bell", "bell"], "🙈": ["ym_hidden", "eye-off"], "💤": ["ym_sleep", "moon"],
  "🔷": ["ym_diamond", "diamond", "#7dd3fc"],
  "🟢": ["ym_dot_green", "dot", "#22c55e"], "🔴": ["ym_dot_red", "dot", "#ef4444"], "🟡": ["ym_dot_yellow", "dot", "#eab308"], "🟠": ["ym_dot_orange", "dot", "#f97316"], "⚪": ["ym_dot_white", "dot", "#e5e7eb"],
};
