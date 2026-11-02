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

interface PendingRequest {
    method: string;
    timer: ReturnType<typeof setTimeout>;
    resolve: (result: unknown) => void;
    reject: (error: Error) => void;
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
    private readonly pending = new Map<number, PendingRequest>();
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
            socket.on('message', (data, isBinary) => this.handleMessage(data, isBinary));
            socket.on('error', (error) => {
                if (!opened) {
                    reject(new InputConnectionError('Could not connect to Input at ' + this.url, error));
                } else {
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

        await new Promise<void>((resolve) => {
            socket.once('close', () => resolve());
            if (socket.readyState === WebSocket.CONNECTING) {
                socket.terminate();
            } else if (socket.readyState !== WebSocket.CLOSING) {
                socket.close(1000, 'Client closed connection');
            }
        });
    }

    public request<T>(method: string, params?: object, timeoutMs = this.requestTimeoutMs): Promise<T> {
        const socket = this.socket;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            return Promise.reject(new InputConnectionError('Connect to Input before making requests'));
        }

        const id = this.allocateRequestId();
        const request: Record<string, unknown> = { jsonrpc: '2.0', id, method };
        if (params !== undefined) request.params = params;

        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new InputRequestTimeoutError(method, timeoutMs));
            }, timeoutMs);

            this.pending.set(id, {
                method,
                timer,
                resolve: (result) => resolve(result as T),
                reject,
            });

            socket.send(JSON.stringify(request), (error) => {
                if (error) {
                    this.rejectRequest(
                        id,
                        new InputConnectionError('Could not send ' + method + ' request', error),
                    );
                }
            });
        });
    }

    private allocateRequestId(): number {
        for (let attempt = 0; attempt <= this.pending.size; attempt += 1) {
            const id = this.nextRequestId;
            this.nextRequestId = id >= Number.MAX_SAFE_INTEGER ? 1 : id + 1;
            if (!this.pending.has(id)) return id;
        }
        throw new Error('Could not allocate a JSON-RPC request ID');
    }

    private handleMessage(data: RawData, isBinary: boolean): void {
        if (isBinary) {
            this.emit('protocolError', new InputProtocolError('Input sent an unexpected binary frame'));
            this.socket?.close(1003, 'Text messages only');
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
        const id = message.id;
        if (typeof id !== 'number' || !Number.isSafeInteger(id)) return;

        const pending = this.pending.get(id);
        if (!pending) return;

        if (isRecord(message.error)) {
            if (typeof message.error.code !== 'number' || typeof message.error.message !== 'string') {
                this.rejectRequest(id, new InputProtocolError('Input sent an invalid RPC error'));
                return;
            }
            this.rejectRequest(id, new InputApiError(message.error.code, message.error.message));
            return;
        }

        if (!Object.prototype.hasOwnProperty.call(message, 'result')) {
            this.rejectRequest(id, new InputProtocolError('Input sent an invalid JSON-RPC response'));
            return;
        }

        this.resolveRequest(id, message.result);
    }

    private handleClose(socket: WebSocket, code: number, reason: string): void {
        if (this.socket === socket) this.socket = undefined;
        this.rejectAllPending(
            new InputConnectionError(
                'Input connection closed (' + code + ')' + (reason ? ': ' + reason : ''),
            ),
        );
        this.emit('disconnected', { code, reason });
    }

    private resolveRequest(id: number, result: unknown): void {
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.resolve(result);
    }

    private rejectRequest(id: number, error: Error): void {
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.reject(error);
    }

    private rejectAllPending(error: Error): void {
        for (const [id, pending] of this.pending) {
            clearTimeout(pending.timer);
            pending.reject(error);
            this.pending.delete(id);
        }
    }
}

function rawDataToString(data: RawData): string {
    if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
    if (Buffer.isBuffer(data)) return data.toString('utf8');
    return Buffer.from(data).toString('utf8');
}
