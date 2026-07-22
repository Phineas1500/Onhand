// @raindrop-ai/pi-agent currently bundles the Node entry point from its core
// package, which imports AsyncLocalStorage only to suppress recursive tracing.
// Onhand runs in a Chrome MV3 worker, so a minimal no-context implementation is
// sufficient for the local Workshop pilot. It deliberately does not emulate
// Node async context propagation.
export class AsyncLocalStorage<T = unknown> {
	getStore(): T | undefined {
		return undefined;
	}

	run<R, A extends unknown[]>(_: T, callback: (...args: A) => R, ...args: A): R {
		return callback(...args);
	}

	enterWith(_: T) {}

	disable() {}
}
