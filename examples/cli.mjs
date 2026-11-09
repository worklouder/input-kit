import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { InputClient, InputRequestTimeoutError } from '../dist/index.js';

const command = process.argv[2] ?? 'watch';
if (command !== 'devices' && command !== 'watch') {
    console.error('Usage: node examples/cli.mjs [devices|watch]');
    process.exitCode = 2;
} else {
    const credentialsPath = getCredentialsPath();
    const client = new InputClient({ applicationName: 'InputKit Example CLI' });

    client.on('devicesUpdated', ({ devices }) => {
        console.log('Devices updated:', JSON.stringify(devices, null, 2));
        void printDeviceStates(client, devices);
    });
    client.on('keyTriggered', ({ deviceId, identifier, action }) => {
        console.log('Key triggered:', deviceId, identifier, action);
    });
    client.on('deviceInfoChanged', ({ deviceId, deviceInfo }) => {
        printDeviceState(deviceId, deviceInfo);
    });
    client.on('disconnected', ({ code, reason }) => {
        console.log('Disconnected:', code, reason || '(no reason)');
    });
    client.on('transportError', (error) => {
        console.error('WebSocket transport error:', error.message);
    });
    client.on('protocolError', (error) => {
        console.error('Input protocol error:', error.message);
    });

    try {
        await client.connect();
        await authenticateOrAuthorize(client, credentialsPath);

        const devices = await client.getDevices();
        console.log('Current devices:', JSON.stringify(devices, null, 2));
        await printDeviceStates(client, devices);

        if (command === 'devices') {
            await client.close();
        } else {
            console.log('Watching Input events. Press Ctrl+C to stop.');
            await waitForShutdown(client);
        }
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
        await client.close();
    }
}

async function authenticateOrAuthorize(client, credentialsPath) {
    const credentials = await readCredentials(credentialsPath);
    if (credentials) {
        try {
            await client.authenticate(credentials);
            console.log('Authenticated with saved demo credentials.');
            return;
        } catch (error) {
            if (error instanceof InputRequestTimeoutError) throw error;
            throw new Error(
                'Saved credentials could not authenticate. Remove the demo credentials file and run again to request authorization.',
                { cause: error },
            );
        }
    }

    console.log('Approve this integration in Input within 29 seconds.');
    const newCredentials = await client.requestAuthorization();
    await saveCredentials(credentialsPath, newCredentials);
    console.log('Authorization approved. Demo credentials saved to ' + credentialsPath);
}

function getCredentialsPath() {
    if (process.env.INPUTKIT_CREDENTIALS_FILE) {
        return process.env.INPUTKIT_CREDENTIALS_FILE;
    }

    const configRoot =
        process.env.INPUTKIT_CONFIG_DIR ||
        (process.platform === 'win32'
            ? process.env.APPDATA || homedir()
            : process.env.XDG_CONFIG_HOME || join(homedir(), '.config'));
    return join(configRoot, 'worklouder', 'input-kit-example', 'credentials.json');
}

async function readCredentials(path) {
    try {
        const value = JSON.parse(await readFile(path, 'utf8'));
        if (
            !value ||
            typeof value.applicationId !== 'string' ||
            typeof value.token !== 'string'
        ) {
            throw new Error('The demo credentials file has an invalid format.');
        }
        return { applicationId: value.applicationId, token: value.token };
    } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
            return undefined;
        }
        throw error;
    }
}

async function saveCredentials(path, credentials) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, JSON.stringify(credentials, null, 2) + '\n', {
        encoding: 'utf8',
        mode: 0o600,
    });
    if (process.platform !== 'win32') await chmod(path, 0o600);
}

async function printDeviceStates(client, devices) {
    for (const device of devices) {
        try {
            const deviceInfo = await client.getDeviceInfo(device.id);
            printDeviceState(device.id, deviceInfo);
        } catch (error) {
            console.error(
                'Could not read device info for ' + device.id + ': ' +
                    (error instanceof Error ? error.message : String(error)),
            );
        }
    }
}

function printDeviceState(deviceId, deviceInfo) {
    const deviceType =
        typeof deviceInfo.deviceType === 'string' ? ' (' + deviceInfo.deviceType + ')' : '';
    const status = isRecord(deviceInfo.deviceStatus) ? deviceInfo.deviceStatus : undefined;
    if (!status) {
        console.log(
            'Device ' + deviceId + deviceType + ': active profile/layer status is not available yet',
        );
        return;
    }

    const profileIndex = Number.isSafeInteger(status.selectedProfileIndex)
        ? status.selectedProfileIndex
        : 'unknown';
    const layerIndex = Number.isSafeInteger(status.selectedLayerIndex) && status.selectedLayerIndex > 0
        ? status.selectedLayerIndex
        : 'unknown';
    console.log(
        'Device ' + deviceId + deviceType + ': profile index ' + profileIndex +
            ' (starts at 0), layer index ' + layerIndex + ' (starts at 1)',
    );
}

function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function waitForShutdown(client) {
    return new Promise((resolve) => {
        const shutdown = () => {
            process.off('SIGINT', shutdown);
            process.off('SIGTERM', shutdown);
            void client.close().finally(resolve);
        };
        process.once('SIGINT', shutdown);
        process.once('SIGTERM', shutdown);
    });
}
