import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const packagePath = fileURLToPath(new URL('../package.json', import.meta.url));
const remote = 'origin';
const releaseBranch = 'main';

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
    try {
        main(process.argv.slice(2));
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}

function main(args) {
    const command = args[0];
    if (!command || command === '--help' || command === '-h') {
        printUsage();
        return;
    }

    switch (command) {
        case 'prepare':
            prepareRelease(args.slice(1));
            return;
        case 'publish':
            publishRelease(args.slice(1));
            return;
        case 'verify-tag':
            verifyTag(args.slice(1));
            return;
        default:
            throw new Error('Unknown release command: ' + command + '\n\n' + usage());
    }
}

function prepareRelease(args) {
    const { positionals, push, dryRun } = parseArguments(args);
    if (positionals.length !== 1) {
        throw new Error('prepare requires patch, minor, major, or an exact x.y.z version');
    }

    const manifest = readManifest();
    const currentVersion = parseVersion(manifest.version);
    const nextVersion = resolveNextVersion(currentVersion, positionals[0]);
    const tag = 'v' + formatVersion(nextVersion);
    const branch = 'release/' + tag;

    assertCleanWorkingTree();
    assertMainIsCurrent();
    assertRefDoesNotExist('refs/heads/' + branch, 'Local release branch already exists: ' + branch);
    assertRefDoesNotExist(
        'refs/remotes/' + remote + '/' + branch,
        'Remote release branch already exists: ' + branch,
    );
    assertRefDoesNotExist('refs/tags/' + tag, 'Release tag already exists: ' + tag);

    console.log('Preparing InputKit ' + manifest.version + ' -> ' + nextVersion.join('.'));

    if (dryRun) {
        runReleaseChecks();
        console.log('Dry run complete. No branch, commit, or tag was created.');
        return;
    }

    const originalManifest = readFileSync(packagePath, 'utf8');
    let committed = false;
    run('git', ['switch', '-c', branch]);

    try {
        manifest.version = nextVersion.join('.');
        writeFileSync(packagePath, JSON.stringify(manifest, null, 2) + '\n');
        runReleaseChecks();
        run('git', ['add', 'package.json']);
        run('git', ['commit', '-m', 'chore(release): ' + tag]);
        committed = true;

        if (push) {
            run('git', ['push', '--set-upstream', remote, branch]);
            console.log(
                'Open a pull request: https://github.com/worklouder/input-kit/compare/' +
                    releaseBranch + '...' + encodeURIComponent(branch) + '?expand=1',
            );
        } else {
            console.log('Release branch created locally. Push it with: git push -u origin ' + branch);
        }
    } catch (error) {
        if (!committed) {
            writeFileSync(packagePath, originalManifest);
            run('git', ['restore', '--staged', 'package.json'], { allowFailure: true });
            run('git', ['switch', releaseBranch], { allowFailure: true });
            run('git', ['branch', '-D', branch], { allowFailure: true });
        }
        throw error;
    }
}

function publishRelease(args) {
    const { positionals, push, dryRun } = parseArguments(args);
    if (positionals.length !== 0) {
        throw new Error('publish does not accept a version; it releases package.json as written');
    }

    const manifest = readManifest();
    const version = formatVersion(parseVersion(manifest.version));
    const tag = 'v' + version;

    assertCleanWorkingTree();
    assertMainIsCurrent();
    assertRefDoesNotExist('refs/tags/' + tag, 'Release tag already exists: ' + tag);
    runReleaseChecks();

    if (dryRun) {
        console.log('Dry run complete. ' + tag + ' is ready to be tagged.');
        return;
    }

    run('git', ['tag', '--annotate', tag, '--message', tag]);
    if (push) {
        run('git', ['push', remote, tag]);
        console.log('Pushed ' + tag + '. The release workflow will publish it to npm.');
    } else {
        console.log('Created local tag ' + tag + '. Push it with: git push origin ' + tag);
    }
}

function verifyTag(args) {
    if (args.length > 1) throw new Error('verify-tag accepts at most one tag');
    const manifest = readManifest();
    const expected = 'v' + formatVersion(parseVersion(manifest.version));
    const actual = args[0] ?? process.env.GITHUB_REF_NAME;
    if (!actual) throw new Error('Provide a tag or set GITHUB_REF_NAME');
    if (actual !== expected) {
        throw new Error('Release tag ' + actual + ' does not match package version ' + expected);
    }
    console.log(actual + ' matches package.json');
}

function parseArguments(args) {
    const positionals = [];
    let push = false;
    let dryRun = false;

    for (const argument of args) {
        if (argument === '--push') push = true;
        else if (argument === '--dry-run') dryRun = true;
        else if (argument.startsWith('--')) throw new Error('Unknown option: ' + argument);
        else positionals.push(argument);
    }
    if (push && dryRun) throw new Error('--push and --dry-run cannot be used together');
    return { positionals, push, dryRun };
}

function assertCleanWorkingTree() {
    if (capture('git', ['status', '--porcelain'])) {
        throw new Error('The working tree must be clean before preparing or publishing a release');
    }
}

function assertMainIsCurrent() {
    const branch = capture('git', ['branch', '--show-current']);
    if (branch !== releaseBranch) {
        throw new Error('Releases must start from ' + releaseBranch + '; current branch is ' + branch);
    }

    run('git', ['fetch', '--prune', '--tags', remote]);
    const localHead = capture('git', ['rev-parse', 'HEAD']);
    const remoteHead = capture('git', ['rev-parse', remote + '/' + releaseBranch]);
    if (localHead !== remoteHead) {
        throw new Error(releaseBranch + ' must exactly match ' + remote + '/' + releaseBranch);
    }
}

function assertRefDoesNotExist(ref, message) {
    try {
        execFileSync('git', ['show-ref', '--verify', '--quiet', ref], { cwd: root });
    } catch {
        return;
    }
    throw new Error(message);
}

function runReleaseChecks() {
    run('yarn', ['test']);
    run('npm', ['pack', '--dry-run', '--ignore-scripts']);
}

function readManifest() {
    return JSON.parse(readFileSync(packagePath, 'utf8'));
}

export function parseVersion(value) {
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
    if (!match) throw new Error('Expected a stable semantic version in x.y.z form, received: ' + value);
    return match.slice(1).map(Number);
}

export function resolveNextVersion(current, selector) {
    if (selector === 'major') return [current[0] + 1, 0, 0];
    if (selector === 'minor') return [current[0], current[1] + 1, 0];
    if (selector === 'patch') return [current[0], current[1], current[2] + 1];

    const exact = parseVersion(selector);
    if (compareVersions(exact, current) <= 0) {
        throw new Error(selector + ' must be greater than the current version ' + formatVersion(current));
    }
    return exact;
}

export function compareVersions(left, right) {
    for (let index = 0; index < 3; index += 1) {
        if (left[index] !== right[index]) return left[index] - right[index];
    }
    return 0;
}

export function formatVersion(version) {
    return version.join('.');
}

function run(command, args, options = {}) {
    try {
        execFileSync(command, args, { cwd: root, stdio: 'inherit' });
    } catch (error) {
        if (options.allowFailure) return;
        throw new Error('Command failed: ' + command + ' ' + args.join(' '), { cause: error });
    }
}

function capture(command, args) {
    return execFileSync(command, args, { cwd: root, encoding: 'utf8' }).trim();
}

function printUsage() {
    console.log(usage());
}

function usage() {
    return `Usage:
  yarn release prepare <patch|minor|major|x.y.z> [--push|--dry-run]
  yarn release publish [--push|--dry-run]
  yarn release verify-tag [vX.Y.Z]

prepare creates a release branch and version commit for pull-request review.
publish validates main, creates its version tag, and optionally pushes the tag.
verify-tag checks that a release tag exactly matches package.json.`;
}
