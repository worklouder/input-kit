import type { InputProtocolError } from './errors.js';

export type LoopbackHost = '127.0.0.1' | '::1' | 'localhost';

export interface InputClientOptions {
    applicationName: string;
    host?: LoopbackHost;
    port?: number;
    requestTimeoutMs?: number;
}

export interface AuthorizationCredentials {
    applicationId: string;
    token: string;
}

export interface DeviceSummary {
    id: number;
    deviceType: string;
}

export type DeviceInfo = Record<string, unknown>;
export type ApiKeyAction = 'press' | 'release' | 'click';

export interface ApiKeyEvent {
    deviceId: number;
    identifier: string;
    action: ApiKeyAction;
}

export interface DevicesUpdatedEvent {
    devices: DeviceSummary[];
}

export interface DeviceInfoChangedEvent {
    deviceId: number;
    deviceInfo: DeviceInfo;
}

export interface InputNotification {
    method: string;
    params: Record<string, unknown>;
}

export interface InputClientEvents {
    devicesUpdated: DevicesUpdatedEvent;
    deviceInfoChanged: DeviceInfoChangedEvent;
    apiKey: ApiKeyEvent;
    notification: InputNotification;
    disconnected: { code: number; reason: string };
    transportError: Error;
    protocolError: InputProtocolError;
}

export interface ChangeProfileLayerOptions {
    deviceId: number;
    /** Zero-based profile index. */
    profileIndex: number;
    /** Zero-based layer index within the selected profile. */
    layerIndex: number;
}

export interface ChangeKeyLightingOptions {
    deviceId: number;
    identifier: string;
    isRegex: boolean;
    color?: number;
    brightness?: number;
    effect?: number;
    speed?: number;
}

/**
 * JSON preset data accepted by Input's addLayer WebSocket method.
 * This mirrors the public shape of Input's PresetDTO without depending on the
 * desktop application's private TypeScript modules.
 */
export interface Preset {
    id: number;
    name: string;
    tags?: string[];
    description?: string;
    author?: string;
    base64Image?: string;
    os: number[];
    keyboardLayoutTypes: string[];
    devices: string[];
    layer: object;
    actionGroups: object[];
    multiactionGroups: object[];
    smartActionGroups?: object[];
    actions: object[];
    multiactions: object[];
    smartActions?: object[];
    previewImg?: string;
}

export interface AddLayerOptions {
    deviceId: number;
    /** Zero-based profile index. */
    profileIndex: number;
    preset: Preset;
}
