/** Default public Bot API server. */
export const DEFAULT_API_SERVER = 'https://api.telegram.org';

/** Telegram's limit for message text, counted after HTML entities are parsed. */
export const MESSAGE_LIMIT = 4096;

/** Chunk size used when splitting long notes. Leaves headroom below {@link MESSAGE_LIMIT}. */
export const MESSAGE_CHUNK_LIMIT = 4000;

/** Telegram's limit for media captions. */
export const CAPTION_LIMIT = 1024;

/** Largest file a bot may upload through the public Bot API ("50 MB", read conservatively). */
export const UPLOAD_LIMIT_BYTES = 50 * 1000 * 1000;

/** Largest file a bot may download through the public Bot API ("20 MB", read conservatively). */
export const DOWNLOAD_LIMIT_BYTES = 20 * 1000 * 1000;

/** A note that needs more messages than this is sent as a file instead. */
export const MAX_TEXT_MESSAGES = 10;

/** Files read as text (UTF-8) instead of binary. */
export const TEXT_FILE_EXTENSIONS = new Set(['md', 'txt', 'canvas', 'base', 'json', 'csv']);

/** Files that can be sent as Telegram text messages. */
export const MESSAGE_FILE_EXTENSIONS = new Set(['md', 'txt']);

/** Files treated as "notes" for automatic backups and note-only archives. */
export const NOTE_EXTENSIONS = new Set(['md', 'canvas', 'base']);

/** Folder used when a backup file is downloaded from Telegram into the vault. */
export const DOWNLOAD_FOLDER = 'Telegram downloads';

export const MEGABYTE = 1024 * 1024;
