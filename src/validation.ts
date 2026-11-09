import type {
    DeviceInfo,
    DeviceStatus,
    DeviceSummary,
    SetKeyLightingOptions,
} from './contracts.js';

const MAX_IDENTIFIER_LENGTH = 128;
const MAX_IDENTIFIER_PATTERN_LENGTH = 256;
const SUPPORTED_LIGHTING_EFFECTS = new Set([0, 1, 3, 4, 6]);

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
