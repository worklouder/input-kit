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

/** Lighting for one side of a layer. Unset fields are filled by Input based on the effect. */
export interface SideLighting {
    /** 0 off, 1 solid, 2 snake, 3 rainbow, 4 breath, 5 gradient. */
    effect: number;
    /** Packed RGB color from 0 to 0xFFFFFF. */
    color?: number;
    brightness?: number;
    speed?: number;
    magic?: number;
}

/** Backlight and underglow of a layer added by addLayer. Provide at least one side. */
export interface LayerLights {
    backlight?: SideLighting;
    underglow?: SideLighting;
}

// Enum-like fields are typed as number or string, not literal unions, so definitions imported
// from JSON files stay assignable. InputKit checks their values at runtime.

/** One key, encoder movement, or button. `KA_<id>` keycodes refer to the definition's actions. */
export interface LayerKey {
    keycode: string;
}

export interface JoystickSector {
    /** Keycode of the sector. */
    k: string;
    /** Start angle. */
    a1: number;
    /** End angle. */
    a2: number;
}

export interface LayerJoystick {
    type: string;
    sectors?: JoystickSector[];
}

/** Key rows of a layer. The row shape must match the target device's layout. */
export interface LayerLayout {
    base: LayerKey[][];
    encoders: LayerKey[][];
    buttons?: LayerKey[][];
    /** Required exactly when the device has a joystick. */
    joystick?: LayerJoystick;
}

/** The `layer` of a LayerDefinition. */
export interface LayerDefinitionLayer {
    /** Safe integer. Input assigns the added layer a new ID. */
    id: number;
    name: string;
    /** CSS color, for example `#FF0000`. */
    color: string;
    /** 0 macOS, 1 Windows. Input assumes macOS when omitted. */
    os?: number;
    layout: LayerLayout;
    lights?: LayerLights;
}

export interface KeyInput {
    keycode: string;
    /** Delay in milliseconds. */
    delay: number;
    /** 0 release, 1 press, 2 click. */
    actionType: number;
}

interface BaseLayerAction {
    /** Safe integer referenced by groups and `KA_<id>` keycodes. Input remaps it on import. */
    id: number;
    name: string;
    color?: string | null;
    icon?: string;
}

export interface LayerAction extends BaseLayerAction {
    keyInputs: KeyInput[];
}

export interface LayerMultiaction extends BaseLayerAction {
    tap: KeyInput;
    onHold: KeyInput;
    doubleTap: KeyInput;
    tapHold: KeyInput;
    tappingTerms: number;
}

export type SmartActionPayload =
    | { text: string }
    | { url: string }
    | { name: string; path: string }
    | { id: string };

export interface LayerSmartAction extends BaseLayerAction {
    /** `TEXT_STEP`, `APP_STEP`, `URL_STEP`, or `API`. Command steps are not allowed. */
    type: string;
    payload: SmartActionPayload;
}

export interface ActionGroup {
    id: number;
    name: string;
    tags?: string[];
    color?: string;
    /** IDs of actions defined in the same definition. */
    actionIds: number[];
}

/** JSON-compatible layer definition accepted by addLayer. */
export interface LayerDefinition {
    id: number;
    name: string;
    tags?: string[];
    description?: string;
    author?: string;
    base64Image?: string;
    /** 0 macOS, 1 Windows. */
    os: number[];
    keyboardLayoutTypes: string[];
    devices: string[];
    layer: LayerDefinitionLayer;
    actionGroups: ActionGroup[];
    multiactionGroups: ActionGroup[];
    smartActionGroups?: ActionGroup[];
    actions: LayerAction[];
    multiactions: LayerMultiaction[];
    smartActions?: LayerSmartAction[];
    previewImg?: string;
}

export interface AddLayerOptions {
    deviceId: number;
    /** Zero-based profile index. */
    profileIndex: number;
    definition: LayerDefinition;
}
