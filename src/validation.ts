import { InputProtocolError } from './errors.js';
import type { DeviceSummary } from './contracts.js';

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
    if (!Number.isSafeInteger(layerIndex) || layerIndex < 0) {
        throw new RangeError('layerIndex must be a non-negative safe integer');
    }
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

export function requireRecord(value: unknown, message: string): Record<string, unknown> {
    if (!isRecord(value)) throw new InputProtocolError(message);
    return value;
}
