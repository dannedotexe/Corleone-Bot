/**
 * Eigene Corleone-Emojis (dunkle Kachel mit Goldrand). Unicode-Emoji → Bot-Emoji-Name, Icon (Lucide) und Farbe.
 * Die Bilder liegen in assets/emojis/<name>.png (erzeugt mit scripts/build-emojis.mjs).
 */
const GREEN = "#34d399", RED = "#f87171", AMBER = "#fbbf24";
export const EMOJI_SET = {
  "✅": ["co_check", "check", GREEN], "☑️": ["co_check_box", "square-check", GREEN], "👍": ["co_thumbs_up", "thumbs-up", GREEN],
  "❌": ["co_x", "x", RED], "✖️": ["co_x", "x", RED], "👎": ["co_thumbs_down", "thumbs-down", RED],
  "🚫": ["co_ban", "ban", RED], "⛔": ["co_stop", "octagon-x", RED], "🚩": ["co_flag_red", "flag", RED], "🚨": ["co_siren", "siren", RED],
  "⚠️": ["co_warning", "triangle-alert", AMBER],
  "📅": ["co_calendar", "calendar-days"], "📆": ["co_calendar", "calendar-days"], "🗓️": ["co_calendar_range", "calendar-range"],
  "⏳": ["co_hourglass", "hourglass"], "⏱️": ["co_timer", "timer"], "⏰": ["co_alarm", "alarm-clock"], "🕒": ["co_clock", "clock-3"], "🕓": ["co_clock", "clock-3"],
  "🎉": ["co_party", "party-popper"], "🎫": ["co_ticket", "ticket"], "🎟️": ["co_ticket", "ticket"], "🏆": ["co_trophy", "trophy"],
  "💰": ["co_wallet", "wallet"], "💸": ["co_payout", "banknote-arrow-up"], "💵": ["co_banknote", "banknote"], "🏦": ["co_bank", "landmark"], "💎": ["co_gem", "gem"],
  "↩️": ["co_undo", "undo-2"], "📸": ["co_camera", "camera"], "⚖️": ["co_scale", "scale"], "🤝": ["co_handshake", "handshake"],
  "📋": ["co_clipboard", "clipboard-list"], "📝": ["co_note", "notebook-pen"], "✍️": ["co_pen", "pen-line"], "✏️": ["co_pencil", "pencil"],
  "📊": ["co_chart", "chart-column"], "📈": ["co_trend", "trending-up"], "📨": ["co_mail", "mail"], "🏅": ["co_medal", "medal"],
  "🥇": ["co_medal_gold", "medal", "#f5c542"], "🥈": ["co_medal_silver", "medal", "#d1d5db"], "🥉": ["co_medal_bronze", "medal", "#d08a4f"],
  "🧾": ["co_receipt", "receipt-text"], "🛡️": ["co_shield", "shield"], "🙋": ["co_hand", "hand"], "👋": ["co_wave", "hand"],
  "🔒": ["co_lock", "lock"], "🔓": ["co_unlock", "lock-open"], "🔑": ["co_key", "key-round"],
  "👤": ["co_user", "user"], "👥": ["co_users", "users"], "👔": ["co_briefcase", "briefcase"], "👕": ["co_shirt", "shirt"], "👢": ["co_footprints", "footprints"],
  "🏁": ["co_flag", "flag"], "➖": ["co_minus", "minus"], "➕": ["co_plus", "plus"], "💬": ["co_chat", "message-circle"],
  "🔎": ["co_search", "search"], "🔍": ["co_search", "search"], "🛠️": ["co_tools", "wrench"], "🔧": ["co_tools", "wrench"], "🧰": ["co_toolbox", "toolbox"], "⚙️": ["co_settings", "settings"],
  "🎯": ["co_target", "target"], "🗳️": ["co_vote", "vote"], "🧭": ["co_compass", "compass"], "📌": ["co_pin", "pin"], "📍": ["co_location", "map-pin"],
  "💡": ["co_idea", "lightbulb"], "🔥": ["co_flame", "flame"], "👑": ["co_crown", "crown"], "📢": ["co_megaphone", "megaphone"], "📣": ["co_megaphone", "megaphone"],
  "🔇": ["co_mute", "volume-x"], "🔊": ["co_sound", "volume-2"], "🔄": ["co_refresh", "refresh-cw"], "🔁": ["co_repeat", "repeat"],
  "📚": ["co_book", "book-open"], "📄": ["co_file", "file-text"], "📂": ["co_folder", "folder-open"], "🗂️": ["co_folders", "folders"], "📒": ["co_notebook", "notebook"], "📜": ["co_scroll", "scroll-text"],
  "⭐": ["co_star", "star"], "🎁": ["co_gift", "gift"], "🌐": ["co_globe", "globe"], "🏓": ["co_activity", "activity"], "🏷️": ["co_tag", "tag"], "📲": ["co_phone", "smartphone"],
  "🆕": ["co_new", "sparkles"], "🔮": ["co_magic", "wand-sparkles"], "☁️": ["co_cloud", "cloud"], "☀️": ["co_sun", "sun"], "🌊": ["co_waves", "waves"], "🌿": ["co_leaf", "leaf"], "🌱": ["co_sprout", "sprout"],
  "🛒": ["co_cart", "shopping-cart"], "🆘": ["co_help", "life-buoy"], "➡️": ["co_arrow", "arrow-right"], "🔔": ["co_bell", "bell"], "🙈": ["co_hidden", "eye-off"], "💤": ["co_sleep", "moon"],
  "🔷": ["co_diamond", "diamond", "#7dd3fc"],
  "🟢": ["co_dot_green", "dot", "#22c55e"], "🔴": ["co_dot_red", "dot", "#ef4444"], "🟡": ["co_dot_yellow", "dot", "#eab308"], "🟠": ["co_dot_orange", "dot", "#f97316"], "⚪": ["co_dot_white", "dot", "#e5e7eb"],
};
