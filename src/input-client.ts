import { EventEmitter } from 'node:events';
import { decodeInputNotification } from './notifications.js';
import { JsonRpcTransport } from './transport/json-rpc-transport.js';
import {
    InputProtocolError,
} from './errors.js';
import type {
    AddLayerOptions,
    ChangeKeyLightingOptions,
    ChangeProfileLayerOptions,
    DeviceInfo,
    InputClientEvents,
    InputClientOptions,
    AuthorizationCredentials,
    DeviceSummary,
} from './contracts.js';
import {
    assertDeviceId,
    assertLayerIndex,
    assertProfileIndex,
    isRecord,
    parseDeviceSummaries,
    requireRecord,
} from './validation.js';

const DEFAULT_PORT = 19147;
const AUTHORIZATION_TIMEOUT_MS = 35_000;
const MAX_APPLICATION_NAME_LENGTH = 80;

/** Public client for Input's local WebSocket API. */
export class InputClient extends EventEmitter {
    private readonly applicationName: string;
    private readonly transport: JsonRpcTransport;

    public constructor(options: InputClientOptions) {
        super();

        const host = options.host ?? '127.0.0.1';
        const port = options.port ?? DEFAULT_PORT;
        const requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
        const applicationName = options.applicationName.trim();

        if (!['127.0.0.1', '::1', 'localhost'].includes(host)) {
            throw new TypeError('InputClient only supports loopback hosts');
        }
        if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
            throw new RangeError('port must be an integer between 1 and 65535');
        }
        if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1) {
            throw new RangeError('requestTimeoutMs must be a positive safe integer');
        }
        if (
            applicationName.length === 0 ||
            applicationName.length > MAX_APPLICATION_NAME_LENGTH ||
            /[\u0000-\u001f\u007f\u2028\u2029]/u.test(applicationName)
        ) {
            throw new TypeError('applicationName must be 1 to 80 printable characters');
        }

        this.applicationName = applicationName;
        this.transport = new JsonRpcTransport({ host, port, requestTimeoutMs });
        this.transport.on('notification', (notification) => this.forwardNotification(notification));
        this.transport.on('disconnected', (event) => this.emit('disconnected', event));
        this.transport.on('transportError', (error) => this.emit('transportError', error));
        this.transport.on('protocolError', (error) => this.emit('protocolError', error));
    }

    public get url(): string {
        return this.transport.url;
    }

    public get connected(): boolean {
        return this.transport.connected;
    }

    public on<K extends keyof InputClientEvents>(
        eventName: K,
        listener: (event: InputClientEvents[K]) => void,
    ): this;
    public override on(eventName: string | symbol, listener: (...args: any[]) => void): this {
        return super.on(eventName, listener);
    }

    public connect(): Promise<void> {
        return this.transport.connect();
    }

    public close(): Promise<void> {
        return this.transport.close();
    }

    public async requestAuthorization(): Promise<AuthorizationCredentials> {
        const result = await this.transport.request<unknown>(
            'requestAutorization',
            { applicationName: this.applicationName },
            AUTHORIZATION_TIMEOUT_MS,
        );
        if (
            !isRecord(result) ||
            typeof result.applicationId !== 'string' ||
            typeof result.token !== 'string'
        ) {
            throw new InputProtocolError('Input returned invalid authorization credentials');
        }
        return { applicationId: result.applicationId, token: result.token };
    }

    public async authenticate(credentials: AuthorizationCredentials): Promise<void> {
        const result = await this.transport.request<unknown>('authenticate', credentials);
        if (!isRecord(result) || result.authenticated !== true) {
            throw new InputProtocolError('Input returned an invalid authentication response');
        }
    }

    public async getDevices(): Promise<DeviceSummary[]> {
        const result = await this.transport.request<unknown>('getDevices');
        const devices = parseDeviceSummaries(result);
        if (!devices) throw new InputProtocolError('Input returned an invalid device list');
        return devices;
    }

    public async getDeviceInfo(deviceId: number): Promise<DeviceInfo> {
        assertDeviceId(deviceId);
        const result = await this.transport.request<unknown>('getDeviceInfo', { deviceId });
        return requireRecord(result, 'Input returned invalid device information');
    }

    public async changeProfileLayer(
        options: ChangeProfileLayerOptions,
    ): Promise<{ changed: true }> {
        assertDeviceId(options.deviceId);
        assertProfileIndex(options.profileIndex);
        assertLayerIndex(options.layerIndex);
        const result = await this.transport.request<unknown>('changeProfileLayer', options);
        if (!isRecord(result) || result.changed !== true) {
            throw new InputProtocolError('Input returned an invalid changeProfileLayer response');
        }
        return { changed: true };
    }

    public async changeKeyLighting(
        options: ChangeKeyLightingOptions,
    ): Promise<{ applied: true }> {
        assertDeviceId(options.deviceId);
        const result = await this.transport.request<unknown>('changeKeyLighting', options);
        if (!isRecord(result) || result.applied !== true) {
            throw new InputProtocolError('Input returned an invalid lighting response');
        }
        return { applied: true };
    }

    public async addLayer(options: AddLayerOptions): Promise<{ added: true }> {
        assertDeviceId(options.deviceId);
        assertProfileIndex(options.profileIndex);
        const result = await this.transport.request<unknown>('addLayer', options);
        if (!isRecord(result) || result.added !== true) {
            throw new InputProtocolError('Input returned an invalid addLayer response');
        }
        return { added: true };
    }

    private forwardNotification(notification: { method: string; params: Record<string, unknown> }): void {
        let decoded;
        try {
            decoded = decodeInputNotification(notification.method, notification.params);
        } catch (error) {
            this.emit(
                'protocolError',
                error instanceof InputProtocolError
                    ? error
                    : new InputProtocolError('Input sent an invalid notification'),
            );
            return;
        }

        switch (decoded.type) {
            case 'devicesUpdated':
                this.emit('devicesUpdated', decoded.event);
                break;
            case 'deviceInfoChanged':
                this.emit('deviceInfoChanged', decoded.event);
                break;
            case 'apiKey':
                this.emit('apiKey', decoded.event);
                break;
        }
        this.emit('notification', notification);
    }
}
