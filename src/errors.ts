export class InputApiError extends Error {
    public constructor(
        public readonly code: number,
        message: string,
    ) {
        super(message);
        this.name = 'InputApiError';
    }
}

/**
 * Input rejected a device write because the device's shared rate-limit budget
 * is used up. The connection stays open and the request can be retried once
 * earlier requests leave the 10-second window.
 */
export class InputDeviceRateLimitError extends InputApiError {
    public constructor(
        public readonly method: string,
        public readonly deviceId: number,
        message: string,
    ) {
        super(-32017, message);
        this.name = 'InputDeviceRateLimitError';
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
