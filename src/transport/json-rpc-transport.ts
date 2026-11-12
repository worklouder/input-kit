import { TypedEventEmitter } from '../event-emitter.js';
import {
    InputApiError,
    InputConnectionError,
    InputProtocolError,
    InputRequestTimeoutError,
} from '../errors.js';
import type { InputNotification, LoopbackHost } from '../contracts.js';
import { isRecord } from '../validation.js';

interface TransportEvents {
    notification: InputNotification;
    disconnected: { code: number; reason: string };
    transportError: Error;
    protocolError: InputProtocolError;
}

const MAX_REQUEST_BYTES = 512 * 1024;
// The standard WebSocket client has no handshake timeout option.
const HANDSHAKE_TIMEOUT_MS = 5_000;
// Application close code sent when Input sends a binary frame. The standard
// close() only accepts 1000 or 3000-4999, so 1003 cannot be used.
const UNSUPPORTED_DATA_CLOSE_CODE = 4003;
// WebSocket readyState values, from the WebSocket standard.
const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

const utf8Encoder = new TextEncoder();
// Input allows 30 requests per connection in a rolling 10-second window.
const REQUEST_SPACING_MS = 400;

interface QueuedRequest {
    id: number;
    method: string;
    frame: string;
    timeoutMs: number;
    resolve: (result: unknown) => void;
    reject: (error: Error) => void;
}

interface PendingRequest {
    request: QueuedRequest;
    timer: ReturnType<typeof setTimeout>;
}

interface JsonRpcMessage extends Record<string, unknown> {
    jsonrpc: '2.0';
}

export interface JsonRpcTransportOptions {
    host: LoopbackHost;
    port: number;
    requestTimeoutMs: number;
}

/** Owns the WebSocket connection and JSON-RPC framing/request lifecycle. */
export class JsonRpcTransport extends TypedEventEmitter<TransportEvents> {
    public readonly url: string;

    private socket?: WebSocket;
    private connectPromise?: Promise<void>;
    private abortHandshake?: (error: InputConnectionError) => void;
    private nextRequestId = 1;
    private readonly queue: QueuedRequest[] = [];
    private pending?: PendingRequest;
    private sendTimer?: ReturnType<typeof setTimeout>;
    private nextSendAt = 0;
    private readonly requestTimeoutMs: number;

    public constructor(options: JsonRpcTransportOptions) {
        super();
        this.requestTimeoutMs = options.requestTimeoutMs;
        const authority = options.host === '::1' ? '[::1]' : options.host;
        this.url = 'ws://' + authority + ':' + options.port + '/input';
    }

    public get connected(): boolean {
        return this.socket?.readyState === OPEN;
    }

    public async connect(): Promise<void> {
        if (this.connected) return;
        if (this.connectPromise) return this.connectPromise;

        const WebSocketConstructor = globalThis.WebSocket;
        if (typeof WebSocketConstructor !== 'function') {
            throw new InputConnectionError(
                'This JavaScript runtime has no global WebSocket. InputKit requires Node.js 22.4 or later, ' +
                    'or another runtime with a standard WebSocket.',
            );
        }

        if (this.socket) {
            this.rejectOutstanding(new InputConnectionError('Input connection was replaced'));
        }
        // The standard client always offers permessage-deflate; Input declines it.
        // Node.js sends no Origin header; browsers always send one.
        const socket = new WebSocketConstructor(this.url);
        socket.binaryType = 'arraybuffer';
        this.socket = socket;

        let opened = false;
        const connection = new Promise<void>((resolve, reject) => {
            const abort = (error: InputConnectionError): void => {
                clearTimeout(handshakeTimer);
                if (this.abortHandshake === abort) this.abortHandshake = undefined;
                reject(error);
                // Some runtimes (including Node.js 22's undici) never fire 'close' after
                // close() on a connecting socket, so detach it instead of waiting.
                this.handleClose(socket, 1006, '');
                socket.close();
            };
            const handshakeTimer = setTimeout(() => {
                abort(
                    new InputConnectionError(
                        'Timed out after ' + HANDSHAKE_TIMEOUT_MS / 1000 + ' seconds connecting to Input at ' +
                            this.url + '. Check that Input is open and its WebSocket API is enabled.',
                    ),
                );
            }, HANDSHAKE_TIMEOUT_MS);
            this.abortHandshake = abort;

            socket.addEventListener('open', () => {
                clearTimeout(handshakeTimer);
                if (this.abortHandshake === abort) this.abortHandshake = undefined;
                opened = true;
                resolve();
            });
            socket.addEventListener('message', (event) => {
                if (this.socket === socket && socket.readyState === OPEN) {
                    this.handleMessage(socket, event.data);
                }
            });
            socket.addEventListener('error', (event) => {
                const cause = errorCause(event);
                if (!opened) {
                    clearTimeout(handshakeTimer);
                    reject(
                        new InputConnectionError(
                            'Could not connect to Input at ' + this.url +
                                '. Check that Input is open and its WebSocket API is enabled.',
                            cause,
                        ),
                    );
                } else if (this.socket === socket) {
                    this.emit(
                        'transportError',
                        cause instanceof Error ? cause : new Error('Input WebSocket connection error'),
                    );
                }
            });
            socket.addEventListener('close', (event) => {
                clearTimeout(handshakeTimer);
                if (this.abortHandshake === abort) this.abortHandshake = undefined;
                this.handleClose(socket, event.code, event.reason);
                if (!opened) {
                    reject(
                        new InputConnectionError(
                            'Input closed the connection before the WebSocket opened' +
                                (event.reason ? ': ' + event.reason : ''),
                        ),
                    );
                }
            });
        });

        this.connectPromise = connection;
        try {
            await connection;
        } finally {
            if (this.connectPromise === connection) this.connectPromise = undefined;
        }
    }

    public async close(): Promise<void> {
        const socket = this.socket;
        if (!socket || socket.readyState === CLOSED) return;

        if (socket.readyState === CONNECTING) {
            const error = new InputConnectionError('Input connection was closed before it opened');
            if (this.abortHandshake) {
                this.abortHandshake(error);
            } else {
                this.handleClose(socket, 1006, '');
                socket.close();
            }
            return;
        }

        const closed = new Promise<void>((resolve) => {
            socket.addEventListener('close', () => resolve(), { once: true });
            if (socket.readyState !== CLOSING) {
                socket.close(1000, 'Client closed connection');
            }
        });
        this.rejectOutstanding(new InputConnectionError('Input connection is closing'));
        await closed;
    }

    public async request<T>(method: string, params?: object, timeoutMs = this.requestTimeoutMs): Promise<T> {
        const socket = this.socket;
        if (!socket || socket.readyState !== OPEN) {
            throw new InputConnectionError('Connect to Input before making requests');
        }

        const id = this.nextRequestId;
        this.nextRequestId = id >= Number.MAX_SAFE_INTEGER ? 1 : id + 1;
        const frame = JSON.stringify({ jsonrpc: '2.0', id, method, params });
        if (utf8Encoder.encode(frame).byteLength > MAX_REQUEST_BYTES) {
            throw new RangeError('Input request ' + method + ' exceeds the 512 KiB WebSocket message limit');
        }
        if (this.socket !== socket || socket.readyState !== OPEN) {
            throw new InputConnectionError('Input connection changed while preparing the request');
        }

        return new Promise<T>((resolve, reject) => {
            this.queue.push({
                id,
                method,
                frame,
                timeoutMs,
                resolve: (result) => resolve(result as T),
                reject,
            });
            this.sendNext();
        });
    }

    private sendNext(): void {
        const socket = this.socket;
        const request = this.queue[0];
        if (!socket || socket.readyState !== OPEN || this.pending || this.sendTimer || !request) {
            return;
        }

        const delay = Math.ceil(this.nextSendAt - performance.now());
        if (delay > 0) {
            this.sendTimer = setTimeout(() => {
                this.sendTimer = undefined;
                this.sendNext();
            }, delay);
            return;
        }

        // Queued requests only start their response timer when they are sent.
        this.queue.shift();
        const timer = setTimeout(() => {
            this.rejectRequest(request, new InputRequestTimeoutError(request.method, request.timeoutMs));
        }, request.timeoutMs);
        this.pending = { request, timer };
        this.nextSendAt = performance.now() + REQUEST_SPACING_MS;

        const onSendError = (error: Error): void => {
            this.rejectRequest(
                request,
                new InputConnectionError('Could not send ' + request.method + ' request', error),
            );
        };
        try {
            socket.send(request.frame);
        } catch (error) {
            onSendError(error instanceof Error ? error : new Error(String(error)));
        }
    }

    private handleMessage(socket: WebSocket, data: unknown): void {
        // Text frames arrive as strings; with binaryType 'arraybuffer' anything else is binary.
        if (typeof data !== 'string') {
            socket.close(UNSUPPORTED_DATA_CLOSE_CODE, 'Text messages only');
            this.emit('protocolError', new InputProtocolError('Input sent an unexpected binary frame'));
            return;
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(data);
        } catch {
            this.emit('protocolError', new InputProtocolError('Input sent invalid JSON'));
            return;
        }

        if (!isRecord(parsed) || parsed.jsonrpc !== '2.0') {
            this.emit('protocolError', new InputProtocolError('Input sent an invalid JSON-RPC message'));
            return;
        }

        const message = parsed as JsonRpcMessage;
        if (Object.prototype.hasOwnProperty.call(message, 'id')) {
            this.handleResponse(message);
            return;
        }

        if (typeof message.method === 'string' && isRecord(message.params)) {
            this.emit('notification', { method: message.method, params: message.params });
            return;
        }

        this.emit('protocolError', new InputProtocolError('Input sent an invalid notification'));
    }

    private handleResponse(message: JsonRpcMessage): void {
        const pending = this.pending;
        if (!pending || message.id !== pending.request.id) return;
        const { request } = pending;

        if (isRecord(message.error)) {
            if (typeof message.error.code !== 'number' || typeof message.error.message !== 'string') {
                this.rejectRequest(request, new InputProtocolError('Input sent an invalid RPC error'));
                return;
            }
            this.rejectRequest(request, new InputApiError(message.error.code, message.error.message));
            return;
        }

        if (!Object.prototype.hasOwnProperty.call(message, 'result')) {
            this.rejectRequest(request, new InputProtocolError('Input sent an invalid JSON-RPC response'));
            return;
        }

        clearTimeout(pending.timer);
        this.pending = undefined;
        request.resolve(message.result);
        this.sendNext();
    }

    private handleClose(socket: WebSocket, code: number, reason: string): void {
        if (this.socket !== socket) return;
        this.socket = undefined;
        this.rejectOutstanding(
            new InputConnectionError(
                'Input connection closed (' + code + ')' + (reason ? ': ' + reason : ''),
            ),
        );
        this.emit('disconnected', { code, reason });
    }

    private rejectRequest(request: QueuedRequest, error: Error): void {
        if (this.pending?.request !== request) return;
        clearTimeout(this.pending.timer);
        this.pending = undefined;
        request.reject(error);
        this.sendNext();
    }

    private rejectOutstanding(error: InputConnectionError): void {
        clearTimeout(this.sendTimer);
        this.sendTimer = undefined;
        this.nextSendAt = 0;
        if (this.pending) {
            clearTimeout(this.pending.timer);
            this.pending.request.reject(error);
            this.pending = undefined;
        }
        for (const request of this.queue) request.reject(error);
        this.queue.length = 0;
    }
}

function errorCause(event: Event): Error | undefined {
    // Standard WebSocket error events carry no detail; some runtimes attach one.
    const error = (event as { error?: unknown }).error;
    return error instanceof Error ? error : undefined;
}
