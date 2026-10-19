import type { TgChat } from './types';

/**
 * Builds a t.me link to a message. Public channels and groups use their
 * username; private ones use the `t.me/c/<id>` form, which works for members.
 * Private chats with the bot have no shareable links.
 */
export function messageLink(chat: Pick<TgChat, 'id' | 'type' | 'username'>, messageId: number): string | undefined {
	if (chat.username && (chat.type === 'channel' || chat.type === 'supergroup')) {
		return `https://t.me/${chat.username}/${messageId}`;
	}
	const id = String(chat.id);
	if (id.startsWith('-100')) return `https://t.me/c/${id.slice(4)}/${messageId}`;
	return undefined;
}
