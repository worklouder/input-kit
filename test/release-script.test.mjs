import assert from 'node:assert/strict';
import test from 'node:test';
import {
    compareVersions,
    formatVersion,
    parseVersion,
    resolveNextVersion,
} from '../scripts/release.mjs';

test('parses and formats stable semantic versions', () => {
    assert.deepEqual(parseVersion('0.1.0'), [0, 1, 0]);
    assert.deepEqual(parseVersion('22.14.3'), [22, 14, 3]);
    assert.equal(formatVersion([22, 14, 3]), '22.14.3');

    for (const invalid of ['v1.2.3', '1.2', '1.2.3-beta.1', '01.2.3', '1.02.3', '1.2.03']) {
        assert.throws(() => parseVersion(invalid), /stable semantic version/);
    }
});

test('calculates release versions and rejects non-increasing exact versions', () => {
    const current = [0, 1, 0];
    assert.deepEqual(resolveNextVersion(current, 'patch'), [0, 1, 1]);
    assert.deepEqual(resolveNextVersion(current, 'minor'), [0, 2, 0]);
    assert.deepEqual(resolveNextVersion(current, 'major'), [1, 0, 0]);
    assert.deepEqual(resolveNextVersion(current, '0.5.0'), [0, 5, 0]);

    assert.throws(() => resolveNextVersion(current, '0.1.0'), /must be greater/);
    assert.throws(() => resolveNextVersion(current, '0.0.9'), /must be greater/);
});

test('compares semantic version tuples', () => {
    assert.equal(compareVersions([1, 0, 0], [0, 99, 99]) > 0, true);
    assert.equal(compareVersions([1, 2, 0], [1, 1, 99]) > 0, true);
    assert.equal(compareVersions([1, 2, 3], [1, 2, 3]), 0);
    assert.equal(compareVersions([1, 2, 2], [1, 2, 3]) < 0, true);
});
