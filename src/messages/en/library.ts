/**
 * English for the library's own keys: why a library file was refused or an
 * entry left out of it, and the specific sentence for a blocked delete, an
 * item that has gone, a library file that is full and a brand kit that cannot
 * be kept. The generic sentence for each `library/*` code is in studio.ts.
 *
 * The keys sit in the dom area (`dom.library.*`), since src/dom emits them:
 * src/dom/file-library.ts for both stores, which is where `libraryErrorKey`
 * picks one of the error sentences by the error's reason.
 */

export const LIBRARY_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
	'dom.library.issue.too-large':
		'This file is too large to be a library. A library file holds at most {max} bytes.',
	'dom.library.issue.too-deep': 'This file nests too deeply to be a library, so it was not opened.',
	'dom.library.issue.not-json':
		'This file could not be read as a library. Choose a .qrlibrary.json file saved from the studio.',
	'dom.library.issue.not-a-library':
		'This is not a library file. Choose a .qrlibrary.json file saved from the studio.',
	'dom.library.issue.version':
		'This library was saved by a different version of the studio and cannot be opened here.',
	'dom.library.issue.unknown-key':
		'This library file has a part the studio does not know, so it was not opened.',
	'dom.library.issue.too-many':
		'This library file holds {count} entries of one kind, and a library holds at most {max}.',
	'dom.library.issue.unreadable': 'This file could not be read. Choose it again.',
	'dom.library.issue.content':
		'A saved item held the content of a code, which a library never keeps, so it was left out.',
	'dom.library.issue.corrupt': 'A saved item is damaged and was left out.',
	'dom.library.error.blocked':
		'The library is open in another tab. Close that tab and the library will be deleted.',
	'dom.library.error.missing': 'That saved item is no longer in the library.',
	'dom.library.error.file-full':
		'This library holds as much as one file can. Remove something, or save it and start another.',
	'dom.library.error.kit': 'This brand kit has a colour, logo or preset the studio cannot use.',
});
