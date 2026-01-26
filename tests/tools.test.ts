import { runPolyglotValidation } from '../src/tools';
import * as child_process from 'child_process';
import * as fs from 'fs';
import path from 'path';

// Mock child_process and fs
jest.mock('child_process');
jest.mock('fs');

const mockedExec = child_process.exec as unknown as jest.Mock;
const mockedFsExistsSync = fs.existsSync as unknown as jest.Mock;

describe('runPolyglotValidation', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should run biome if package.json exists', async () => {
        mockedFsExistsSync.mockImplementation((p: string) => p.endsWith('package.json'));
        mockedExec.mockImplementation((cmd: string, opts: any, cb: any) => cb(null, { stdout: '' }));

        const result = await runPolyglotValidation('/tmp/test');
        expect(result.output).toContain('✅ Biome: Passed');
        expect(mockedExec).toHaveBeenCalledWith(expect.stringContaining('biome check'), expect.anything(), expect.anything());
    });

    it('should run ruff if pyproject.toml exists', async () => {
        mockedFsExistsSync.mockImplementation((p: string) => p.endsWith('pyproject.toml'));
        mockedExec.mockImplementation((cmd: string, opts: any, cb: any) => cb(null, { stdout: '' }));

        const result = await runPolyglotValidation('/tmp/test');
        expect(result.output).toContain('✅ Ruff: Passed');
        expect(mockedExec).toHaveBeenCalledWith(expect.stringContaining('ruff check'), expect.anything(), expect.anything());
    });

    it('should fail if tool execution fails', async () => {
        mockedFsExistsSync.mockImplementation((p: string) => p.endsWith('package.json'));
        mockedExec.mockImplementation((cmd: string, opts: any, cb: any) => {
            if (cmd.includes('biome')) {
                const err: any = new Error('Biome failed');
                err.stdout = 'Lint errors';
                cb(err, { stdout: 'Lint errors' });
            } else {
                cb(null, { stdout: '' });
            }
        });

        const result = await runPolyglotValidation('/tmp/test');
        expect(result.success).toBe(false);
        expect(result.output).toContain('❌ Biome: Lint errors');
    });

    it('should always run semgrep', async () => {
        mockedFsExistsSync.mockReturnValue(false);
        mockedExec.mockImplementation((cmd: string, opts: any, cb: any) => cb(null, { stdout: '' }));

        const result = await runPolyglotValidation('/tmp/test');
        expect(result.output).toContain('✅ Semgrep: Secure');
        expect(mockedExec).toHaveBeenCalledWith(expect.stringContaining('semgrep scan'), expect.anything(), expect.anything());
    });
});
