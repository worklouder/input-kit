import { TypedEventEmitter } from './event-emitter.js';
import { decodeInputNotification } from './notifications.js';
import { JsonRpcTransport } from './transport/json-rpc-transport.js';
import { InputProtocolError } from './errors.js';
import type {
    AddLayerOptions,
    SetKeyLightingOptions,
    SetActiveProfileLayerOptions,
    DeviceInfo,
    InputClientEvents,
    InputClientOptions,
    AuthorizationCredentials,
    DeviceSummary,
} from './contracts.js';
import {
    assertDeviceId,
    assertKeyLightingOptions,
    assertLayerIndex,
    assertProfileIndex,
    isRecord,
    parseDeviceInfo,
    parseDeviceSummaries,
} from './validation.js';

const DEFAULT_PORT = 19147;
// Input starts its 30-second unauthenticated timer when the connection opens.
const AUTHORIZATION_TIMEOUT_MS = 29_000;
const DEFAULT_ADD_LAYER_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 2_147_483_647;
const MAX_APPLICATION_NAME_LENGTH = 80;
const DISALLOWED_APPLICATION_NAME_CHARACTERS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/** Public client for Input's local WebSocket API. */
export class InputClient extends TypedEventEmitter<InputClientEvents> {
    private readonly applicationName: string;
    private readonly addLayerTimeoutMs: number;
    private readonly transport: JsonRpcTransport;

    public constructor(options: InputClientOptions) {
        super();

        const host = options.host ?? '127.0.0.1';
        const port = options.port ?? DEFAULT_PORT;
        const requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
        const addLayerTimeoutMs = options.addLayerTimeoutMs ?? DEFAULT_ADD_LAYER_TIMEOUT_MS;
        const normalizedApplicationName = options.applicationName.normalize('NFKC');
        const applicationName = normalizedApplicationName.trim();

        if (!['127.0.0.1', '::1', 'localhost'].includes(host)) {
            throw new TypeError('InputClient only supports loopback hosts');
        }
        if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
            throw new RangeError('port must be an integer between 1 and 65535');
        }
        assertTimeoutMs('requestTimeoutMs', requestTimeoutMs);
        assertTimeoutMs('addLayerTimeoutMs', addLayerTimeoutMs);
        if (
            applicationName.length === 0 ||
            applicationName.length > MAX_APPLICATION_NAME_LENGTH ||
            DISALLOWED_APPLICATION_NAME_CHARACTERS.test(normalizedApplicationName)
        ) {
            throw new TypeError('applicationName must be 1 to 80 printable characters');
        }

        this.applicationName = applicationName;
        this.addLayerTimeoutMs = addLayerTimeoutMs;
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

    public connect(): Promise<void> {
        return this.transport.connect();
    }

    public close(): Promise<void> {
        return this.transport.close();
    }

    public async requestAuthorization(): Promise<AuthorizationCredentials> {
        const result = await this.transport.request<unknown>(
            'requestAuthorization',
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
        const { applicationId, token } = credentials;
        const result = await this.transport.request<unknown>('authenticate', { applicationId, token });
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
        const deviceInfo = parseDeviceInfo(result);
        if (!deviceInfo) throw new InputProtocolError('Input returned invalid device information');
        return deviceInfo;
    }

    public async setActiveProfileLayer(
        options: SetActiveProfileLayerOptions,
    ): Promise<{ changed: true }> {
        const { deviceId, profileIndex, layerIndex } = options;
        assertDeviceId(deviceId);
        assertProfileIndex(profileIndex);
        assertLayerIndex(layerIndex);
        const result = await this.transport.request<unknown>(
            'setActiveProfileLayer',
            { deviceId, profileIndex, layerIndex },
        );
        if (!isRecord(result) || result.changed !== true) {
            throw new InputProtocolError('Input returned an invalid setActiveProfileLayer response');
        }
        return { changed: true };
    }

    public async setKeyLighting(
        options: SetKeyLightingOptions,
    ): Promise<{ applied: true }> {
        const { deviceId, identifier, isRegex, color, brightness, effect, speed } = options;
        // JSON serialization omits undefined optional fields.
        const params = { deviceId, identifier, isRegex, color, brightness, effect, speed };
        assertKeyLightingOptions(params);
        const result = await this.transport.request<unknown>('setKeyLighting', params);
        if (!isRecord(result) || result.applied !== true) {
            throw new InputProtocolError('Input returned an invalid lighting response');
        }
        return { applied: true };
    }

    public async addLayer(options: AddLayerOptions): Promise<{ added: true }> {
        const { deviceId, profileIndex, definition } = options;
        assertDeviceId(deviceId);
        assertProfileIndex(profileIndex);
        const result = await this.transport.request<unknown>(
            'addLayer',
            { deviceId, profileIndex, definition },
            this.addLayerTimeoutMs,
        );
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
            case 'keyTriggered':
                this.emit('keyTriggered', decoded.event);
                break;
        }
        this.emit('notification', notification);
    }
}

function assertTimeoutMs(name: string, value: number): void {
    if (!Number.isInteger(value) || value < 1 || value > MAX_TIMEOUT_MS) {
        throw new RangeError(name + ' must be an integer between 1 and ' + MAX_TIMEOUT_MS);
    }
}
