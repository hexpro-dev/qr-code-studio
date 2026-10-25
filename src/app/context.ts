/**
 * What every view is handed: the studio, the registries it was made with, the
 * library, and a way to say something to a screen reader.
 *
 * A view keeps no document state. It reads the snapshot it is given, draws
 * what changed since the last one (the studio keeps a slice's identity while
 * it is the same, so "changed" is an identity check), and turns what the
 * person does into an action or a command.
 */

import type { Registries } from '../registries.js';
import type { Studio, StudioAction, StudioSnapshot } from '../studio/index.js';
import type { FileLibraryStore } from './library-file.js';

export interface AppContext {
	readonly studio: Studio;
	readonly registries: Registries;
	readonly library: FileLibraryStore;
	dispatch(action: StudioAction): void;
	snapshot(): StudioSnapshot;
	/** Say something in the live region: a result that arrived later, a copy, a save. */
	announce(text: string): void;
}

export interface View {
	update(snapshot: StudioSnapshot): void;
}
