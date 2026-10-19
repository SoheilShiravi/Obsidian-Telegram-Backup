/* Subset of the Telegram Bot API types used by this plugin. https://core.telegram.org/bots/api */

export interface TgUser {
	id: number;
	is_bot: boolean;
	first_name: string;
	last_name?: string;
	username?: string;
}

export type TgChatType = 'private' | 'group' | 'supergroup' | 'channel';

export interface TgChat {
	id: number;
	type: TgChatType;
	title?: string;
	username?: string;
	first_name?: string;
	last_name?: string;
	is_forum?: boolean;
}

export interface TgDocument {
	file_id: string;
	file_unique_id: string;
	file_name?: string;
	mime_type?: string;
	file_size?: number;
}

export interface TgMessage {
	message_id: number;
	date: number;
	chat: TgChat;
	message_thread_id?: number;
	text?: string;
	caption?: string;
	document?: TgDocument;
}

export interface TgFile {
	file_id: string;
	file_unique_id: string;
	file_size?: number;
	file_path?: string;
}

export interface TgChatMember {
	status: 'creator' | 'administrator' | 'member' | 'restricted' | 'left' | 'kicked';
	user: TgUser;
	can_post_messages?: boolean;
	can_edit_messages?: boolean;
	can_delete_messages?: boolean;
}

export interface TgChatMemberUpdated {
	chat: TgChat;
	new_chat_member: TgChatMember;
}

export interface TgUpdate {
	update_id: number;
	message?: TgMessage;
	edited_message?: TgMessage;
	channel_post?: TgMessage;
	edited_channel_post?: TgMessage;
	my_chat_member?: TgChatMemberUpdated;
}

export interface TgResponseParameters {
	retry_after?: number;
	migrate_to_chat_id?: number;
}

export interface TgResponse<T> {
	ok: boolean;
	result?: T;
	error_code?: number;
	description?: string;
	parameters?: TgResponseParameters;
}

/** Display name for a chat. */
export function chatTitle(chat: TgChat): string {
	if (chat.title) return chat.title;
	const name = [chat.first_name, chat.last_name].filter(Boolean).join(' ');
	if (name) return name;
	if (chat.username) return `@${chat.username}`;
	return String(chat.id);
}

export function chatTypeLabel(type: TgChatType): string {
	switch (type) {
		case 'channel':
			return 'Channel';
		case 'supergroup':
			return 'Group';
		case 'group':
			return 'Group';
		case 'private':
			return 'Private chat';
	}
}
