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

    it('should run biome and tsc if package.json and tsconfig.json exist', async () => {
        mockedFsExistsSync.mockImplementation((p: string) => p.endsWith('package.json') || p.endsWith('tsconfig.json'));
        mockedExec.mockImplementation((cmd: string, opts: any, cb: any) => {
            if (cmd.startsWith('find')) return cb(null, { stdout: '' }); // No python files
            cb(null, { stdout: '' });
        });

        const result = await runPolyglotValidation('/mock/workspace');
        expect(result.output).toContain('✅ Biome: Passed');
        expect(result.output).toContain('✅ TSC: Passed');
        expect(mockedExec).toHaveBeenCalledWith(expect.stringContaining('biome check'), expect.anything(), expect.anything());
        expect(mockedExec).toHaveBeenCalledWith(expect.stringContaining('tsc --noEmit'), expect.anything(), expect.anything());
    });

    it('should run ruff and mypy if pyproject.toml exists', async () => {
        mockedFsExistsSync.mockImplementation((p: string) => p.endsWith('pyproject.toml'));
        mockedExec.mockImplementation((cmd: string, opts: any, cb: any) => {
            if (cmd.startsWith('find')) return cb(null, { stdout: '' });
            cb(null, { stdout: '' });
        });

        const result = await runPolyglotValidation('/mock/workspace');
        expect(result.output).toContain('✅ Ruff: Passed');
        expect(result.output).toContain('✅ Mypy: Passed');
        expect(mockedExec).toHaveBeenCalledWith(expect.stringContaining('ruff check'), expect.anything(), expect.anything());
        expect(mockedExec).toHaveBeenCalledWith(expect.stringContaining('mypy --ignore-missing-imports'), expect.anything(), expect.anything());
    });

    it('should run mypy if python files are found via find command', async () => {
        mockedFsExistsSync.mockReturnValue(false); // No config files
        mockedExec.mockImplementation((cmd: string, opts: any, cb: any) => {
            if (cmd.startsWith('find')) {
                cb(null, { stdout: './main.py\n' }); // Found python file
            } else {
                cb(null, { stdout: '' });
            }
        });

        const result = await runPolyglotValidation('/mock/workspace');
        expect(result.output).toContain('✅ Ruff: Passed'); // Ruff runs if python files are detected too? Logic says "hasPython" triggers both
        expect(result.output).toContain('✅ Mypy: Passed');
        expect(mockedExec).toHaveBeenCalledWith(expect.stringContaining('mypy --ignore-missing-imports'), expect.anything(), expect.anything());
    });

    it('should fail if tool execution fails', async () => {
        mockedFsExistsSync.mockImplementation((p: string) => p.endsWith('package.json'));
        mockedExec.mockImplementation((cmd: string, opts: any, cb: any) => {
            if (cmd.startsWith('find')) return cb(null, { stdout: '' });
            
            if (cmd.includes('biome')) {
                const err: any = new Error('Biome failed');
                err.stdout = 'Lint errors';
                cb(err, { stdout: 'Lint errors' });
            } else {
                cb(null, { stdout: '' });
            }
        });

        const result = await runPolyglotValidation('/mock/workspace');
        expect(result.success).toBe(false);
        expect(result.output).toContain('❌ Biome: Lint errors');
    });

    it('should always run semgrep', async () => {
        mockedFsExistsSync.mockReturnValue(false);
        mockedExec.mockImplementation((cmd: string, opts: any, cb: any) => {
            if (cmd.startsWith('find')) return cb(null, { stdout: '' });
            cb(null, { stdout: '' });
        });

        const result = await runPolyglotValidation('/mock/workspace');
        expect(result.output).toContain('✅ Semgrep: Secure');
        expect(mockedExec).toHaveBeenCalledWith(expect.stringContaining('semgrep scan'), expect.anything(), expect.anything());
    });
});
