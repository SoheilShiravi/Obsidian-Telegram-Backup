/* Minimal stand-ins for the parts of the Obsidian API that tested modules import. */

export class TFile {
	path = '';
	extension = 'md';
}

export class Notice {
	static messages: string[] = [];
	constructor(message: string) {
		Notice.messages.push(message);
	}
}

/** Placeholder for the CodeMirror state field that links an editor to its file. */
export const editorInfoField = {};

export function requestUrl(): never {
	throw new Error('requestUrl is not available in tests');
}
