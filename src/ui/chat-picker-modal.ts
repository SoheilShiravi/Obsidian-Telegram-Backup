import { SuggestModal, type App } from 'obsidian';
import { chatTitle, chatTypeLabel, type TgChat } from '../telegram/types';

/** Lets the user pick one of the chats the bot has seen. */
export class ChatPickerModal extends SuggestModal<TgChat> {
	constructor(
		app: App,
		private readonly chats: TgChat[],
		private readonly onPick: (chat: TgChat) => void,
	) {
		super(app);
		this.setPlaceholder('Choose the chat that should receive backups');
	}

	getSuggestions(query: string): TgChat[] {
		const q = query.trim().toLowerCase();
		if (!q) return this.chats;
		return this.chats.filter((chat) => chatTitle(chat).toLowerCase().includes(q) || String(chat.id).includes(q));
	}

	renderSuggestion(chat: TgChat, el: HTMLElement): void {
		el.addClass('telegram-backup-suggestion');
		el.createDiv({ text: chatTitle(chat) });
		el.createDiv({ cls: 'telegram-backup-suggestion-note', text: `${chatTypeLabel(chat.type)} · ${chat.id}` });
	}

	onChooseSuggestion(chat: TgChat): void {
		this.onPick(chat);
	}
}
