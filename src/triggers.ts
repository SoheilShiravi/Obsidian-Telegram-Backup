import type { EditorState, Extension } from '@codemirror/state';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import { editorInfoField, Notice, TFile } from 'obsidian';
import type TelegramBackupPlugin from './main';

export type TriggerKind = 'backup' | 'send';

export interface Trigger {
	kind: TriggerKind;
	text: string;
}

/** Returns the trigger that the text before the cursor ends with, preferring the longest one. */
export function findTrigger(textBeforeCursor: string, triggers: Trigger[]): Trigger | null {
	let found: Trigger | null = null;
	for (const trigger of triggers) {
		if (trigger.text && textBeforeCursor.endsWith(trigger.text) && (!found || trigger.text.length > found.text.length)) {
			found = trigger;
		}
	}
	return found;
}

/**
 * Text to send for the "send" trigger: the current line, or when that line is
 * empty, the paragraph above it.
 */
export function snippetAt(state: EditorState, position: number): string {
	const line = state.doc.lineAt(position);
	const text = line.text.trim();
	if (text) return text;
	const collected: string[] = [];
	for (let n = line.number - 1; n >= 1; n--) {
		const previous = state.doc.line(n).text;
		if (previous.trim() === '') {
			if (collected.length > 0) break;
			continue;
		}
		collected.unshift(previous);
	}
	return collected.join('\n').trim();
}

function runTrigger(plugin: TelegramBackupPlugin, view: EditorView, file: TFile, trigger: Trigger, from: number): void {
	const to = from + trigger.text.length;
	// The document may have changed since the trigger was detected.
	if (to > view.state.doc.length || view.state.sliceDoc(from, to) !== trigger.text) return;
	view.dispatch({ changes: { from, to, insert: '' }, userEvent: 'delete.trigger' });

	if (trigger.kind === 'backup') {
		void plugin.actions.backupFile(file, { trigger: 'trigger', force: true, content: view.state.doc.toString() });
		return;
	}
	const text = snippetAt(view.state, from);
	if (!text) {
		new Notice('Nothing to send. Write some text before the send trigger.');
		return;
	}
	void plugin.actions.sendSnippet(text, file, 'trigger');
}

/**
 * Editor extension that watches for typed triggers such as `;;backup`. Only
 * text the user types or pastes counts, so undoing a removed trigger does not
 * fire it again.
 */
export function triggerExtension(plugin: TelegramBackupPlugin): Extension {
	return EditorView.updateListener.of((update: ViewUpdate) => {
		if (!update.docChanged || !plugin.settings.triggersEnabled) return;
		if (!update.transactions.some((transaction) => transaction.isUserEvent('input'))) return;
		const triggers = plugin.getTriggers();
		if (triggers.length === 0) return;

		const { state } = update;
		const head = state.selection.main.head;
		const line = state.doc.lineAt(head);
		const trigger = findTrigger(line.text.slice(0, head - line.from), triggers);
		if (!trigger) return;

		const file = state.field(editorInfoField, false)?.file;
		if (!(file instanceof TFile) || file.extension !== 'md') return;

		const from = head - trigger.text.length;
		const { view } = update;
		// The document cannot be changed while CodeMirror is still applying this update.
		window.setTimeout(() => runTrigger(plugin, view, file, trigger, from), 0);
	});
}
