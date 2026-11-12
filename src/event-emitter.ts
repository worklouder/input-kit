type Listener<T> = (event: T) => void;

interface Registration<T> {
    listener: Listener<T>;
    once: boolean;
}

/**
 * Minimal typed event emitter with no runtime dependencies.
 *
 * Each event carries a single payload. Listeners run synchronously in
 * registration order; a listener that throws stops later listeners for that
 * emit and the error propagates to the emitter.
 */
export class TypedEventEmitter<Events extends object> {
    private readonly listeners = new Map<keyof Events, Registration<any>[]>();

    /** Adds a listener for every future `eventName` event. */
    public on<K extends keyof Events>(eventName: K, listener: Listener<Events[K]>): this {
        return this.add(eventName, listener, false);
    }

    /** Adds a listener that is removed after the next `eventName` event. */
    public once<K extends keyof Events>(eventName: K, listener: Listener<Events[K]>): this {
        return this.add(eventName, listener, true);
    }

    /** Removes the most recently added registration of `listener` for `eventName`. */
    public off<K extends keyof Events>(eventName: K, listener: Listener<Events[K]>): this {
        const registrations = this.listeners.get(eventName);
        if (!registrations) return this;
        for (let index = registrations.length - 1; index >= 0; index -= 1) {
            if (registrations[index].listener === listener) {
                registrations.splice(index, 1);
                break;
            }
        }
        if (registrations.length === 0) this.listeners.delete(eventName);
        return this;
    }

    /** Calls the listeners for `eventName`. Returns whether any listener was called. */
    public emit<K extends keyof Events>(eventName: K, event: Events[K]): boolean {
        const registrations = this.listeners.get(eventName);
        if (!registrations) return false;
        for (const registration of [...registrations]) {
            if (registration.once) this.remove(eventName, registration);
            registration.listener(event);
        }
        return true;
    }

    private add<K extends keyof Events>(eventName: K, listener: Listener<Events[K]>, once: boolean): this {
        if (typeof listener !== 'function') {
            throw new TypeError('listener must be a function');
        }
        const registrations = this.listeners.get(eventName);
        if (registrations) registrations.push({ listener, once });
        else this.listeners.set(eventName, [{ listener, once }]);
        return this;
    }

    private remove(eventName: keyof Events, registration: Registration<unknown>): void {
        const registrations = this.listeners.get(eventName);
        if (!registrations) return;
        const index = registrations.indexOf(registration);
        if (index !== -1) registrations.splice(index, 1);
        if (registrations.length === 0) this.listeners.delete(eventName);
    }
}
