/** Resolves after `ms` milliseconds. */
export function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		window.setTimeout(resolve, Math.max(0, ms));
	});
}
