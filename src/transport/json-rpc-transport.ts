import { EventEmitter } from 'node:events';
import WebSocket, { type RawData } from 'ws';
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
export class JsonRpcTransport extends EventEmitter {
    public readonly url: string;

    private socket?: WebSocket;
    private connectPromise?: Promise<void>;
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
        return this.socket?.readyState === WebSocket.OPEN;
    }

    public on<K extends keyof TransportEvents>(
        eventName: K,
        listener: (event: TransportEvents[K]) => void,
    ): this;
    public override on(eventName: string | symbol, listener: (...args: any[]) => void): this {
        return super.on(eventName, listener);
    }

    public async connect(): Promise<void> {
        if (this.connected) return;
        if (this.connectPromise) return this.connectPromise;

        if (this.socket) {
            this.rejectOutstanding(new InputConnectionError('Input connection was replaced'));
        }
        const socket = new WebSocket(this.url, {
            handshakeTimeout: 5_000,
            perMessageDeflate: false,
        });
        this.socket = socket;

        let opened = false;
        const connection = new Promise<void>((resolve, reject) => {
            socket.on('open', () => {
                opened = true;
                resolve();
            });
            socket.on('message', (data, isBinary) => {
                if (this.socket === socket && socket.readyState === WebSocket.OPEN) {
                    this.handleMessage(socket, data, isBinary);
                }
            });
            socket.on('error', (error) => {
                if (!opened) {
                    reject(new InputConnectionError('Could not connect to Input at ' + this.url, error));
                } else if (this.socket === socket) {
                    this.emit('transportError', error);
                }
            });
            socket.on('close', (code, reason) => {
                const message = reason.toString('utf8');
                this.handleClose(socket, code, message);
                if (!opened) {
                    reject(
                        new InputConnectionError(
                            'Input closed the connection before the WebSocket opened' +
                                (message ? ': ' + message : ''),
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
        if (!socket || socket.readyState === WebSocket.CLOSED) return;

        const closed = new Promise<void>((resolve) => {
            socket.once('close', () => resolve());
            if (socket.readyState === WebSocket.CONNECTING) {
                socket.terminate();
            } else if (socket.readyState !== WebSocket.CLOSING) {
                socket.close(1000, 'Client closed connection');
            }
        });
        this.rejectOutstanding(new InputConnectionError('Input connection is closing'));
        await closed;
    }

    public async request<T>(method: string, params?: object, timeoutMs = this.requestTimeoutMs): Promise<T> {
        const socket = this.socket;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            throw new InputConnectionError('Connect to Input before making requests');
        }

        const id = this.nextRequestId;
        this.nextRequestId = id >= Number.MAX_SAFE_INTEGER ? 1 : id + 1;
        const frame = JSON.stringify({ jsonrpc: '2.0', id, method, params });
        if (Buffer.byteLength(frame, 'utf8') > MAX_REQUEST_BYTES) {
            throw new RangeError('Input request ' + method + ' exceeds the 512 KiB WebSocket message limit');
        }
        if (this.socket !== socket || socket.readyState !== WebSocket.OPEN) {
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
        if (!socket || socket.readyState !== WebSocket.OPEN || this.pending || this.sendTimer || !request) {
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
            socket.send(request.frame, (error) => {
                if (error) onSendError(error);
            });
        } catch (error) {
            onSendError(error instanceof Error ? error : new Error(String(error)));
        }
    }

    private handleMessage(socket: WebSocket, data: RawData, isBinary: boolean): void {
        if (isBinary) {
            socket.close(1003, 'Text messages only');
            this.emit('protocolError', new InputProtocolError('Input sent an unexpected binary frame'));
            return;
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(rawDataToString(data));
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

function rawDataToString(data: RawData): string {
    if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
    if (Buffer.isBuffer(data)) return data.toString('utf8');
    return Buffer.from(data).toString('utf8');
}
