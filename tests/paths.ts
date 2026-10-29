// Test paths that are absolute on the platform the tests run on.
//
// The engine resolves every fs path before a test's fs hook sees it, so a
// Windows path like C:/Users/T is relative on Linux and macOS and arrives as
// <plugin dir>/C:/Users/T. The test runtime has no `process`; the module's own
// file URL (file:///C:/... on Windows) tells the platform instead.

export const WIN = /^file:\/\/\/[A-Za-z]:/.test(import.meta.url)

// The stubbed home, in the mod's spelling (forward slashes).
export const HOME = WIN ? 'C:/Users/T' : '/home/T'
// A project folder and a folder of agent packs outside home.
export const PROJ = WIN ? 'C:/proj' : '/proj'
export const PACKS = WIN ? 'C:/packs' : '/packs'

// The home as the OS hands it over: USERPROFILE with backslashes on Windows,
// HOME on Linux and macOS. The mod reads USERPROFILE first, then HOME.
export const HOME_VAR = WIN ? 'USERPROFILE' : 'HOME'
export const HOME_RAW = WIN ? 'C:\\Users\\T' : '/home/T'
export const envHome = (name: string): string | undefined => (name === HOME_VAR ? HOME_RAW : undefined)

// fs hooks key their file maps on forward-slash paths.
export const slash = (path: unknown): string => String(path).replaceAll('\\', '/')

// For a path inside a RegExp.
export const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
