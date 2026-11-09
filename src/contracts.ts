import type { InputProtocolError } from './errors.js';

export type LoopbackHost = '127.0.0.1' | '::1' | 'localhost';

export interface InputClientOptions {
    applicationName: string;
    host?: LoopbackHost;
    port?: number;
    /** Response timeout for ordinary requests. Defaults to 10 seconds. */
    requestTimeoutMs?: number;
    /** Response timeout for addLayer. Defaults to 120 seconds. */
    addLayerTimeoutMs?: number;
}

export interface AuthorizationCredentials {
    applicationId: string;
    token: string;
}

export interface DeviceSummary {
    id: number;
    deviceType: string;
}

export interface DeviceStatus {
    firmwareVersion?: string;
    /** Zero-based active profile index. */
    selectedProfileIndex?: number;
    /** One-based active layer index. */
    selectedLayerIndex?: number;
    batteryPercentage?: number;
    isCharging?: boolean;
}

export interface DeviceInfo {
    portPath: string;
    devicePid: string;
    serialNumber?: string;
    connectionType: number;
    deviceType: string;
    layoutType: string;
    isUsbConnection: boolean;
    deviceStatus?: DeviceStatus;
}
export type KeyTrigger = 'press' | 'release' | 'click';

export interface KeyTriggeredEvent {
    deviceId: number;
    identifier: string;
    action: KeyTrigger;
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
    keyTriggered: KeyTriggeredEvent;
    notification: InputNotification;
    disconnected: { code: number; reason: string };
    transportError: Error;
    protocolError: InputProtocolError;
}

export interface SetActiveProfileLayerOptions {
    deviceId: number;
    /** Zero-based profile index. */
    profileIndex: number;
    /** One-based layer index within the selected profile. */
    layerIndex: number;
}

export interface SetKeyLightingOptions {
    deviceId: number;
    identifier: string;
    isRegex: boolean;
    color?: number;
    brightness?: number;
    effect?: number;
    speed?: number;
}

/** JSON-compatible layer definition accepted by addLayer. */
export interface LayerDefinition {
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
    definition: LayerDefinition;
}
