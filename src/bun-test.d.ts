// Minimal ambient types for the bun test runner, so `tsc --noEmit` resolves
// test files without adding @types/bun to the dependency tree. Bun executes the
// tests directly; these declarations only cover the surface the tests use.
declare module 'bun:test' {
	export function test(name: string, fn: () => void | Promise<void>): void;
	export function expect(value: unknown): {
		toBe(expected: unknown): void;
		toEqual(expected: unknown): void;
		toBeLessThanOrEqual(expected: number): void;
	};
}
