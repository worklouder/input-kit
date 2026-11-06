import { InputProtocolError } from './errors.js';
import type {
    KeyTriggeredEvent,
    DeviceInfoChangedEvent,
    DevicesUpdatedEvent,
    InputNotification,
} from './contracts.js';
import {
    isApiIdentifier,
    isPositiveSafeInteger,
    isRecord,
    parseDeviceInfo,
    parseDeviceSummaries,
} from './validation.js';

export type DecodedInputNotification =
    | { type: 'devicesUpdated'; event: DevicesUpdatedEvent }
    | { type: 'deviceInfoChanged'; event: DeviceInfoChangedEvent }
    | { type: 'keyTriggered'; event: KeyTriggeredEvent }
    | { type: 'other'; event: InputNotification };

export function decodeInputNotification(
    method: string,
    params: Record<string, unknown>,
): DecodedInputNotification {
    switch (method) {
        case 'devicesUpdated': {
            const devices = parseDeviceSummaries(params.devices);
            if (!devices) throw new InputProtocolError('Input sent an invalid devicesUpdated event');
            return { type: 'devicesUpdated', event: { devices } };
        }
        case 'deviceInfoChanged': {
            const deviceInfo = parseDeviceInfo(params.deviceInfo);
            if (!isPositiveSafeInteger(params.deviceId) || !deviceInfo) {
                throw new InputProtocolError('Input sent an invalid deviceInfoChanged event');
            }
            return {
                type: 'deviceInfoChanged',
                event: { deviceId: params.deviceId, deviceInfo },
            };
        }
        case 'keyTriggered': {
            if (
                !isPositiveSafeInteger(params.deviceId) ||
                !isApiIdentifier(params.identifier) ||
                !isKeyTrigger(params.action)
            ) {
                throw new InputProtocolError('Input sent an invalid keyTriggered event');
            }
            return {
                type: 'keyTriggered',
                event: {
                    deviceId: params.deviceId,
                    identifier: params.identifier,
                    action: params.action,
                },
            };
        }
        default:
            return { type: 'other', event: { method, params } };
    }
}

function isKeyTrigger(value: unknown): value is KeyTriggeredEvent['action'] {
    return value === 'press' || value === 'release' || value === 'click';
}
