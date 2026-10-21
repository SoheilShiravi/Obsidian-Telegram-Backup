import { moment } from 'obsidian';

/*
 * Obsidian bundles Moment.js and re-exports it as `moment`. Its type comes from
 * the separate `moment` package, which is not always installed (for example in
 * the automated review of the community directory). Declaring the few methods
 * this plugin uses keeps the code type-safe either way.
 */

interface MomentInstance {
	format(format: string): string;
	fromNow(): string;
}

type MomentFactory = (timestamp?: number) => MomentInstance;

const createMoment = moment as unknown as MomentFactory;

/** Formats a timestamp with a Moment.js format string such as `YYYY-MM-DD HH:mm`. */
export function formatDate(timestamp: number, format: string): string {
	return createMoment(timestamp).format(format);
}

/** Formats the current date and time with a Moment.js format string. */
export function formatNow(format: string): string {
	return createMoment().format(format);
}

/** Relative time such as "5 minutes ago", in Obsidian's language. */
export function fromNow(timestamp: number): string {
	return createMoment(timestamp).fromNow();
}
