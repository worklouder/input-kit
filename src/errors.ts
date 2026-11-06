export class InputApiError extends Error {
    public constructor(
        public readonly code: number,
        message: string,
    ) {
        super(message);
        this.name = 'InputApiError';
    }
}

export class InputConnectionError extends Error {
    public constructor(
        message: string,
        public readonly cause?: Error,
    ) {
        super(message);
        this.name = 'InputConnectionError';
    }
}

export class InputProtocolError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = 'InputProtocolError';
    }
}

export class InputRequestTimeoutError extends Error {
    public constructor(
        public readonly method: string,
        public readonly timeoutMs: number,
    ) {
        super('Input request ' + method + ' timed out after ' + timeoutMs +
            ' ms. The operation outcome may be unknown.');
        this.name = 'InputRequestTimeoutError';
    }
}
