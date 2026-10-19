import { extensionOf } from './paths';

const MIME_TYPES: Record<string, string> = {
	md: 'text/markdown',
	txt: 'text/plain',
	csv: 'text/csv',
	json: 'application/json',
	canvas: 'application/json',
	base: 'text/yaml',
	pdf: 'application/pdf',
	zip: 'application/zip',
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	svg: 'image/svg+xml',
	mp3: 'audio/mpeg',
	m4a: 'audio/mp4',
	wav: 'audio/wav',
	ogg: 'audio/ogg',
	mp4: 'video/mp4',
	webm: 'video/webm',
	mov: 'video/quicktime',
};

export function mimeType(fileName: string): string {
	return MIME_TYPES[extensionOf(fileName)] ?? 'application/octet-stream';
}
