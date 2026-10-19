import { escapeHtml } from '../format/html';
import type TelegramBackupPlugin from '../main';
import { messageLink } from '../telegram/links';
import { chatTitle, chatTypeLabel, type TgChat } from '../telegram/types';

export interface ConnectionReport {
	ok: boolean;
	lines: string[];
}

/** Checks the token, the chat and the bot's permissions, and explains any problem. */
export async function checkConnection(plugin: TelegramBackupPlugin): Promise<ConnectionReport> {
	const { client, settings } = plugin;
	if (!plugin.getBotToken()) {
		return { ok: false, lines: ['⚠️ No bot token yet. Select Link… next to Bot token and add the token from @BotFather as a secret.'] };
	}
	const lines: string[] = [];
	const me = await client.getMe();
	lines.push(`✅ Bot: @${me.username ?? me.first_name}`);

	const chatId = settings.chatId.trim();
	if (!chatId) {
		lines.push('⚠️ No chat ID yet. Select Detect, or enter the ID manually.');
		return { ok: false, lines };
	}
	const chat = await client.getChat(chatId);
	lines.push(`✅ Chat: ${chatTitle(chat)} (${chatTypeLabel(chat.type)})`);

	let ok = true;
	if (chat.type !== 'private') {
		const member = await client.getChatMember(chatId, me.id);
		if (chat.type === 'channel') {
			const canPost = member.status === 'creator' || (member.status === 'administrator' && member.can_post_messages !== false);
			if (canPost) {
				lines.push('✅ The bot can post in this channel.');
			} else {
				ok = false;
				lines.push('⚠️ The bot cannot post here. Make it an administrator with permission to post messages.');
			}
		} else if (member.status === 'left' || member.status === 'kicked') {
			ok = false;
			lines.push('⚠️ The bot is not a member of this group. Add it to the group first.');
		} else {
			lines.push('✅ The bot is a member of this group.');
		}
	}
	if (settings.topicId.trim() && !chat.is_forum) {
		ok = false;
		lines.push('⚠️ A topic ID is set, but this chat does not use topics.');
	}
	return { ok, lines };
}

/**
 * Lists chats the bot has recently seen: channels it was added to or posted in,
 * groups, and private chats where someone pressed Start. Telegram keeps these
 * updates for 24 hours.
 */
export async function detectChats(plugin: TelegramBackupPlugin): Promise<TgChat[]> {
	const updates = await plugin.client.getUpdates();
	const chats = new Map<number, TgChat>();
	for (const update of [...updates].reverse()) {
		const chat =
			update.channel_post?.chat ??
			update.edited_channel_post?.chat ??
			update.my_chat_member?.chat ??
			update.message?.chat ??
			update.edited_message?.chat;
		if (chat && !chats.has(chat.id)) chats.set(chat.id, chat);
	}
	return [...chats.values()];
}

/** Sends a short message to confirm that backups will arrive. */
export async function sendTestMessage(plugin: TelegramBackupPlugin): Promise<string | undefined> {
	const target = plugin.requireTarget();
	const vault = escapeHtml(plugin.app.vault.getName());
	const message = await plugin.sender.sendHtml(`✅ <b>Telegram Backup</b> is connected to the vault <b>${vault}</b>.`);
	const link = messageLink(message.chat, message.message_id);
	plugin.addHistory({
		kind: 'test',
		label: 'Test message',
		trigger: 'manual',
		ok: true,
		format: 'text',
		link,
		messageId: message.message_id,
		chatId: target.chatId,
	});
	return link;
}
