/** A file attached to a multipart/form-data request. */
export interface UploadFile {
	/** Form field name, for example `document`. */
	field: string;
	filename: string;
	data: Uint8Array;
	contentType: string;
}

export interface MultipartBody {
	body: ArrayBuffer;
	contentType: string;
}

const encoder = new TextEncoder();

/** Quotes a header parameter the same way browsers do for form uploads. */
function quote(value: string): string {
	return value.replace(/"/g, '%22').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function randomBoundary(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return '----TelegramBackup' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Builds a multipart/form-data body by hand, because `requestUrl` only accepts
 * a string or an ArrayBuffer as the request body. Header values are UTF-8, so
 * note names in any language survive the upload.
 */
export function buildMultipart(fields: Record<string, string>, files: UploadFile[], boundary = randomBoundary()): MultipartBody {
	const chunks: Uint8Array[] = [];
	for (const [name, value] of Object.entries(fields)) {
		chunks.push(encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${quote(name)}"\r\n\r\n${value}\r\n`));
	}
	for (const file of files) {
		chunks.push(
			encoder.encode(
				`--${boundary}\r\nContent-Disposition: form-data; name="${quote(file.field)}"; filename="${quote(file.filename)}"\r\n` +
					`Content-Type: ${file.contentType}\r\n\r\n`,
			),
		);
		chunks.push(file.data);
		chunks.push(encoder.encode('\r\n'));
	}
	chunks.push(encoder.encode(`--${boundary}--\r\n`));

	let length = 0;
	for (const chunk of chunks) length += chunk.length;
	const out = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return { body: out.buffer, contentType: `multipart/form-data; boundary=${boundary}` };
}
