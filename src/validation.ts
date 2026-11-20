import type {
    DeviceInfo,
    DeviceStatus,
    DeviceSummary,
    SetKeyLightingOptions,
} from './contracts.js';

const MAX_IDENTIFIER_LENGTH = 128;
const MAX_IDENTIFIER_PATTERN_LENGTH = 256;
const SUPPORTED_LIGHTING_EFFECTS = new Set([0, 1, 3, 4, 6]);
const LAYER_LIGHTS_KEYS = new Set(['backlight', 'underglow']);
const SIDE_LIGHTING_KEYS = new Set(['effect', 'color', 'brightness', 'speed', 'magic']);
const SMART_ACTION_TYPES = new Set(['TEXT_STEP', 'APP_STEP', 'URL_STEP', 'API']);

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isPositiveSafeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function assertDeviceId(deviceId: number): void {
    if (!isPositiveSafeInteger(deviceId)) {
        throw new RangeError('deviceId must be a positive safe integer');
    }
}

export function assertProfileIndex(profileIndex: number): void {
    if (!Number.isSafeInteger(profileIndex) || profileIndex < 0) {
        throw new RangeError('profileIndex must be a non-negative safe integer');
    }
}

export function assertLayerIndex(layerIndex: number): void {
    if (!isPositiveSafeInteger(layerIndex)) {
        throw new RangeError('layerIndex must be a positive safe integer (one-based)');
    }
}

export function isApiIdentifier(value: unknown): value is string {
    return (
        typeof value === 'string' &&
        value.length > 0 &&
        value.length <= MAX_IDENTIFIER_LENGTH &&
        value.trim() === value &&
        !/[\u0000-\u001f\u007f\u2028\u2029]/u.test(value)
    );
}

export function assertKeyLightingOptions(options: SetKeyLightingOptions): void {
    const { deviceId, identifier, isRegex, color, brightness, effect, speed } = options;
    assertDeviceId(deviceId);
    if (typeof isRegex !== 'boolean') {
        throw new TypeError('isRegex must be a boolean');
    }
    if (isRegex) {
        if (
            typeof identifier !== 'string' ||
            identifier.length < 1 ||
            identifier.length > MAX_IDENTIFIER_PATTERN_LENGTH
        ) {
            throw new TypeError('identifier pattern must be 1 to 256 UTF-16 code units');
        }
    } else if (!isApiIdentifier(identifier)) {
        throw new TypeError(
            'identifier must be 1 to 128 UTF-16 code units without surrounding whitespace, ' +
                'ASCII control characters, or Unicode line and paragraph separators',
        );
    }
    if ([color, brightness, effect, speed].every((value) => value === undefined)) {
        throw new TypeError('Provide at least one of color, brightness, effect, or speed');
    }
    if (color !== undefined && (!Number.isInteger(color) || color < 0 || color > 0xffffff)) {
        throw new RangeError('color must be an integer between 0 and 0xFFFFFF');
    }
    if (brightness !== undefined && !isUnitInterval(brightness)) {
        throw new RangeError('brightness must be a finite number between 0 and 1');
    }
    if (effect !== undefined && !SUPPORTED_LIGHTING_EFFECTS.has(effect)) {
        throw new RangeError('effect must be 0, 1, 3, 4, or 6');
    }
    if (speed !== undefined && !isUnitInterval(speed)) {
        throw new RangeError('speed must be a finite number between 0 and 1');
    }
}

/**
 * Mirrors Input's structural check of an addLayer definition so mistakes are reported by path.
 * Device layout compatibility and keycode validity can only be checked by Input.
 */
export function assertLayerDefinition(definition: unknown): void {
    const path = 'definition';
    assertRecord(path, definition);
    assertSafeInteger(`${path}.id`, definition.id);
    assertString(`${path}.name`, definition.name);
    assertStringArray(`${path}.devices`, definition.devices);
    assertStringArray(`${path}.keyboardLayoutTypes`, definition.keyboardLayoutTypes);
    assertArray(`${path}.os`, definition.os, (item, itemPath) => assertOs(itemPath, item));
    if (definition.tags !== undefined) assertStringArray(`${path}.tags`, definition.tags);
    assertLayer(`${path}.layer`, definition.layer);
    assertArray(`${path}.actions`, definition.actions, (item, itemPath) => {
        assertBaseAction(itemPath, item);
        assertArray(`${itemPath}.keyInputs`, item.keyInputs, (input, inputPath) => assertKeyInput(inputPath, input));
    });
    assertArray(`${path}.multiactions`, definition.multiactions, (item, itemPath) => {
        assertBaseAction(itemPath, item);
        for (const field of ['tap', 'onHold', 'doubleTap', 'tapHold']) {
            assertKeyInput(`${itemPath}.${field}`, item[field]);
        }
        assertFiniteNumber(`${itemPath}.tappingTerms`, item.tappingTerms);
    });
    if (definition.smartActions !== undefined) {
        assertArray(`${path}.smartActions`, definition.smartActions, (item, itemPath) => {
            assertBaseAction(itemPath, item);
            if (item.type === 'CMD_STEP') {
                throw new TypeError(`${itemPath}.type CMD_STEP is not allowed by addLayer`);
            }
            if (typeof item.type !== 'string' || !SMART_ACTION_TYPES.has(item.type)) {
                throw new TypeError(`${itemPath}.type must be TEXT_STEP, APP_STEP, URL_STEP, or API`);
            }
            assertRecord(`${itemPath}.payload`, item.payload);
        });
    }
    for (const field of ['actionGroups', 'multiactionGroups', 'smartActionGroups']) {
        if (field === 'smartActionGroups' && definition[field] === undefined) continue;
        assertArray(`${path}.${field}`, definition[field], (item, itemPath) => assertGroup(itemPath, item));
    }
}

function assertLayer(path: string, layer: unknown): void {
    assertRecord(path, layer);
    assertSafeInteger(`${path}.id`, layer.id);
    assertString(`${path}.name`, layer.name);
    assertString(`${path}.color`, layer.color);
    if (layer.os !== undefined) assertOs(`${path}.os`, layer.os);
    if (layer.lights !== undefined) assertLayerLights(`${path}.lights`, layer.lights);
    const { layout } = layer;
    assertRecord(`${path}.layout`, layout);
    assertKeyRows(`${path}.layout.base`, layout.base);
    assertKeyRows(`${path}.layout.encoders`, layout.encoders);
    if (layout.buttons !== undefined) assertKeyRows(`${path}.layout.buttons`, layout.buttons);
    if (layout.joystick !== undefined) {
        assertRecord(`${path}.layout.joystick`, layout.joystick);
        const { sectors } = layout.joystick;
        if (sectors !== undefined) {
            assertArray(`${path}.layout.joystick.sectors`, sectors, (sector, sectorPath) => {
                assertRecord(sectorPath, sector);
                assertString(`${sectorPath}.k`, sector.k);
            });
        }
    }
}

function assertLayerLights(path: string, lights: unknown): void {
    assertRecord(path, lights);
    const unknownKey = Object.keys(lights).find((key) => !LAYER_LIGHTS_KEYS.has(key));
    if (unknownKey !== undefined) {
        throw new TypeError(`${path}.${unknownKey} is not a supported field`);
    }
    if (lights.backlight === undefined && lights.underglow === undefined) {
        throw new TypeError(`${path} must include backlight, underglow, or both`);
    }
    for (const side of LAYER_LIGHTS_KEYS) {
        if (lights[side] !== undefined) assertSideLighting(`${path}.${side}`, lights[side]);
    }
}

function assertKeyRows(path: string, rows: unknown): void {
    assertArray(path, rows, (row, rowPath) =>
        assertArray(rowPath, row, (key, keyPath) => {
            assertRecord(keyPath, key);
            assertString(`${keyPath}.keycode`, key.keycode);
        }),
    );
}

function assertBaseAction(path: string, action: unknown): asserts action is Record<string, unknown> {
    assertRecord(path, action);
    assertSafeInteger(`${path}.id`, action.id);
    assertString(`${path}.name`, action.name);
}

function assertKeyInput(path: string, input: unknown): void {
    assertRecord(path, input);
    assertString(`${path}.keycode`, input.keycode);
    assertFiniteNumber(`${path}.delay`, input.delay);
    assertFiniteNumber(`${path}.actionType`, input.actionType);
}

function assertGroup(path: string, group: unknown): void {
    assertRecord(path, group);
    assertSafeInteger(`${path}.id`, group.id);
    assertString(`${path}.name`, group.name);
    assertArray(`${path}.actionIds`, group.actionIds, (id, idPath) => assertSafeInteger(idPath, id));
    if (group.tags !== undefined) assertStringArray(`${path}.tags`, group.tags);
}

function assertOs(path: string, os: unknown): void {
    if (os !== 0 && os !== 1) {
        throw new RangeError(`${path} must be 0 (macOS) or 1 (Windows)`);
    }
}

function assertRecord(path: string, value: unknown): asserts value is Record<string, unknown> {
    if (!isRecord(value)) {
        throw new TypeError(`${path} must be an object`);
    }
}

function assertArray(path: string, value: unknown, assertItem: (item: any, itemPath: string) => void): void {
    if (!Array.isArray(value)) {
        throw new TypeError(`${path} must be an array`);
    }
    value.forEach((item, index) => assertItem(item, `${path}[${index}]`));
}

function assertStringArray(path: string, value: unknown): void {
    assertArray(path, value, (item, itemPath) => assertString(itemPath, item));
}

function assertString(path: string, value: unknown): void {
    if (typeof value !== 'string') {
        throw new TypeError(`${path} must be a string`);
    }
}

function assertSafeInteger(path: string, value: unknown): void {
    if (!Number.isSafeInteger(value)) {
        throw new TypeError(`${path} must be a safe integer`);
    }
}

function assertFiniteNumber(path: string, value: unknown): void {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError(`${path} must be a finite number`);
    }
}

function assertSideLighting(path: string, side: unknown): void {
    if (!isRecord(side)) {
        throw new TypeError(`${path} must be an object`);
    }
    const unknownKey = Object.keys(side).find((key) => !SIDE_LIGHTING_KEYS.has(key));
    if (unknownKey !== undefined) {
        throw new TypeError(`${path}.${unknownKey} is not a supported field`);
    }
    if (!Number.isInteger(side.effect) || (side.effect as number) < 0 || (side.effect as number) > 5) {
        throw new RangeError(`${path}.effect must be an integer from 0 to 5`);
    }
    const { color } = side;
    if (color !== undefined && (!Number.isInteger(color) || (color as number) < 0 || (color as number) > 0xffffff)) {
        throw new RangeError(`${path}.color must be an integer between 0 and 0xFFFFFF`);
    }
    for (const field of ['brightness', 'speed', 'magic']) {
        const value = side[field];
        if (value !== undefined && (typeof value !== 'number' || !isUnitInterval(value))) {
            throw new RangeError(`${path}.${field} must be a finite number between 0 and 1`);
        }
    }
}

function isUnitInterval(value: number): boolean {
    return Number.isFinite(value) && value >= 0 && value <= 1;
}

export function parseDeviceSummaries(value: unknown): DeviceSummary[] | undefined {
    if (!Array.isArray(value)) return undefined;

    const devices: DeviceSummary[] = [];
    for (const item of value) {
        if (!isRecord(item) || !isPositiveSafeInteger(item.id) || typeof item.deviceType !== 'string') {
            return undefined;
        }
        devices.push({ id: item.id, deviceType: item.deviceType });
    }
    return devices;
}

export function parseDeviceInfo(value: unknown): DeviceInfo | undefined {
    if (
        !isRecord(value) ||
        typeof value.portPath !== 'string' ||
        typeof value.devicePid !== 'string' ||
        typeof value.connectionType !== 'number' ||
        !Number.isFinite(value.connectionType) ||
        typeof value.deviceType !== 'string' ||
        typeof value.layoutType !== 'string' ||
        typeof value.isUsbConnection !== 'boolean' ||
        (value.serialNumber !== undefined && typeof value.serialNumber !== 'string')
    ) {
        return undefined;
    }

    const deviceStatus = value.deviceStatus === undefined
        ? undefined
        : parseDeviceStatus(value.deviceStatus);
    if (value.deviceStatus !== undefined && !deviceStatus) return undefined;

    return {
        portPath: value.portPath,
        devicePid: value.devicePid,
        serialNumber: value.serialNumber,
        connectionType: value.connectionType,
        deviceType: value.deviceType,
        layoutType: value.layoutType,
        isUsbConnection: value.isUsbConnection,
        deviceStatus,
    };
}

function parseDeviceStatus(value: unknown): DeviceStatus | undefined {
    if (
        !isRecord(value) ||
        (value.firmwareVersion !== undefined && typeof value.firmwareVersion !== 'string') ||
        !isOptionalNonNegativeSafeInteger(value.selectedProfileIndex) ||
        !isOptionalPositiveSafeInteger(value.selectedLayerIndex) ||
        (value.batteryPercentage !== undefined &&
            (typeof value.batteryPercentage !== 'number' ||
                !Number.isFinite(value.batteryPercentage) ||
                value.batteryPercentage < 0 ||
                value.batteryPercentage > 100)) ||
        (value.isCharging !== undefined && typeof value.isCharging !== 'boolean')
    ) {
        return undefined;
    }

    return {
        firmwareVersion: value.firmwareVersion,
        selectedProfileIndex: value.selectedProfileIndex,
        selectedLayerIndex: value.selectedLayerIndex,
        batteryPercentage: value.batteryPercentage,
        isCharging: value.isCharging,
    };
}

function isOptionalNonNegativeSafeInteger(value: unknown): value is number | undefined {
    return (
        value === undefined ||
        (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
    );
}

function isOptionalPositiveSafeInteger(value: unknown): value is number | undefined {
    return value === undefined || isPositiveSafeInteger(value);
}
