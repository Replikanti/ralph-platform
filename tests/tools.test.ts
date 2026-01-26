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
            // Directly delegate to the handler without redundant conditional checks
            execHandler(cmd, cb);
        });
    };

    // Simple handler that returns success for everything
    const successHandler = (_cmd: string, cb: any) => cb(null, { stdout: '' });

    it('should run biome and tsc if package.json and tsconfig.json exist', async () => {
        setupMocks(
            (p) => p.endsWith('package.json') || p.endsWith('tsconfig.json'),
            successHandler
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
            successHandler
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
                // Only treat find command differently
                if (cmd.startsWith('find')) {
                    cb(null, { stdout: './main.py\n' });
                } else {
                    cb(null, { stdout: '' });
                }
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
        setupMocks(() => false, successHandler);

        const result = await runPolyglotValidation('/mock/workspace');
        expect(result.output).toContain('✅ Semgrep: Secure');
        expect(mockedExec).toHaveBeenCalledWith(expect.stringContaining('semgrep scan'), expect.anything(), expect.anything());
    });
});
