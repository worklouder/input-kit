import { InputProtocolError } from './errors.js';
import type {
    ApiKeyEvent,
    DeviceInfoChangedEvent,
    DevicesUpdatedEvent,
    InputNotification,
} from './contracts.js';
import { isPositiveSafeInteger, isRecord, parseDeviceSummaries } from './validation.js';

export type DecodedInputNotification =
    | { type: 'devicesUpdated'; event: DevicesUpdatedEvent }
    | { type: 'deviceInfoChanged'; event: DeviceInfoChangedEvent }
    | { type: 'apiKey'; event: ApiKeyEvent }
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
        case 'onDeviceInfoChanged': {
            if (!isPositiveSafeInteger(params.deviceId) || !isRecord(params.deviceInfo)) {
                throw new InputProtocolError('Input sent an invalid onDeviceInfoChanged event');
            }
            return {
                type: 'deviceInfoChanged',
                event: { deviceId: params.deviceId, deviceInfo: params.deviceInfo },
            };
        }
        case 'onApiKey': {
            if (
                !isPositiveSafeInteger(params.deviceId) ||
                typeof params.identifier !== 'string' ||
                !isApiKeyAction(params.action)
            ) {
                throw new InputProtocolError('Input sent an invalid onApiKey event');
            }
            return {
                type: 'apiKey',
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

function isApiKeyAction(value: unknown): value is ApiKeyEvent['action'] {
    return value === 'press' || value === 'release' || value === 'click';
}
