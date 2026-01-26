import { runPolyglotValidation } from '../src/tools';
import * as child_process from 'node:child_process';
import * as fs from 'node:fs';

// Mock child_process and fs
jest.mock('node:child_process');
jest.mock('node:fs');

const mockedExec = child_process.exec as unknown as jest.Mock;
const mockedFsExistsSync = fs.existsSync as unknown as jest.Mock;

describe('runPolyglotValidation', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const setupMocks = (
        fileFilter: (p: string) => boolean,
        execHandler: (cmd: string, cb: any) => void = (cmd, cb) => cb(null, { stdout: '' })
    ) => {
        mockedFsExistsSync.mockImplementation(fileFilter);
        mockedExec.mockImplementation((cmd: string, opts: any, cb: any) => {
            if (cmd.startsWith('find')) {
                // Default find behavior unless overridden by execHandler logic inside it?
                // Actually simpler: pass execHandler that handles all.
                // If specific 'find' logic is needed, handle it in the passed handler or a default.
                execHandler(cmd, cb);
            } else {
                execHandler(cmd, cb);
            }
        });
    };

    const defaultExecHandler = (cmd: string, cb: any) => {
        if (cmd.startsWith('find')) cb(null, { stdout: '' });
        else cb(null, { stdout: '' });
    };

    it('should run biome and tsc if package.json and tsconfig.json exist', async () => {
        setupMocks(
            (p) => p.endsWith('package.json') || p.endsWith('tsconfig.json'),
            defaultExecHandler
        );

        const result = await runPolyglotValidation('/mock/workspace');
        expect(result.output).toContain('✅ Biome: Passed');
        expect(result.output).toContain('✅ TSC: Passed');
        expect(mockedExec).toHaveBeenCalledWith(expect.stringContaining('biome check'), expect.anything(), expect.anything());
        expect(mockedExec).toHaveBeenCalledWith(expect.stringContaining('tsc --noEmit'), expect.anything(), expect.anything());
    });

    it('should run ruff and mypy if pyproject.toml exists', async () => {
        setupMocks(
            (p) => p.endsWith('pyproject.toml'),
            defaultExecHandler
        );

        const result = await runPolyglotValidation('/mock/workspace');
        expect(result.output).toContain('✅ Ruff: Passed');
        expect(result.output).toContain('✅ Mypy: Passed');
        expect(mockedExec).toHaveBeenCalledWith(expect.stringContaining('ruff check'), expect.anything(), expect.anything());
        expect(mockedExec).toHaveBeenCalledWith(expect.stringContaining('mypy --ignore-missing-imports'), expect.anything(), expect.anything());
    });

    it('should run mypy if python files are found via find command', async () => {
        setupMocks(
            () => false,
            (cmd, cb) => {
                if (cmd.startsWith('find')) cb(null, { stdout: './main.py\n' });
                else cb(null, { stdout: '' });
            }
        );

        const result = await runPolyglotValidation('/mock/workspace');
        expect(result.output).toContain('✅ Ruff: Passed');
        expect(result.output).toContain('✅ Mypy: Passed');
        expect(mockedExec).toHaveBeenCalledWith(expect.stringContaining('mypy --ignore-missing-imports'), expect.anything(), expect.anything());
    });

    it('should fail if tool execution fails', async () => {
        setupMocks(
            (p) => p.endsWith('package.json'),
            (cmd, cb) => {
                if (cmd.startsWith('find')) return cb(null, { stdout: '' });
                if (cmd.includes('biome')) {
                    const err: any = new Error('Biome failed');
                    err.stdout = 'Lint errors';
                    cb(err, { stdout: 'Lint errors' });
                } else {
                    cb(null, { stdout: '' });
                }
            }
        );

        const result = await runPolyglotValidation('/mock/workspace');
        expect(result.success).toBe(false);
        expect(result.output).toContain('❌ Biome: Lint errors');
    });

    it('should always run semgrep', async () => {
        setupMocks(() => false, defaultExecHandler);

        const result = await runPolyglotValidation('/mock/workspace');
        expect(result.output).toContain('✅ Semgrep: Secure');
        expect(mockedExec).toHaveBeenCalledWith(expect.stringContaining('semgrep scan'), expect.anything(), expect.anything());
    });
});
