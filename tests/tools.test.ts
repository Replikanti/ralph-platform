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
        mockedExec.mockImplementation((cmd: string, opts: any, cb: any) => execHandler(cmd, cb));
    };

    const successHandler = (_cmd: string, cb: any) => cb(null, { stdout: '' });

    const runAndAssert = async (
        expectedStrings: string[],
        execCalls: string[] = [],
        expectSuccess = true
    ) => {
        const result = await runPolyglotValidation('/mock/workspace');
        if (expectSuccess) {
            // Check for success implicitly via checking expected output strings or explicit success flag if needed
             // But runPolyglotValidation returns { success, output }
            if (!result.success && expectSuccess) {
                 // If we expected success but got failure, fail the test with output
                 expect(result.success).toBe(true); 
            }
        } else {
             expect(result.success).toBe(false);
        }

        for (const str of expectedStrings) {
            expect(result.output).toContain(str);
        }
        for (const call of execCalls) {
             expect(mockedExec).toHaveBeenCalledWith(expect.stringContaining(call), expect.anything(), expect.anything());
        }
        return result;
    };

    it('should run biome and tsc if package.json and tsconfig.json exist', async () => {
        setupMocks(
            (p) => p.endsWith('package.json') || p.endsWith('tsconfig.json'),
            successHandler
        );
        await runAndAssert(
            ['✅ Biome: Passed', '✅ TSC: Passed'],
            ['biome check', 'tsc --noEmit']
        );
    });

    it('should run ruff and mypy if pyproject.toml exists', async () => {
        setupMocks(
            (p) => p.endsWith('pyproject.toml'),
            successHandler
        );
        await runAndAssert(
            ['✅ Ruff: Passed', '✅ Mypy: Passed'],
            ['ruff check', 'mypy --ignore-missing-imports']
        );
    });

    it('should run mypy if python files are found via find command', async () => {
        setupMocks(
            () => false,
            (cmd, cb) => {
                if (cmd.startsWith('find')) cb(null, { stdout: './main.py\n' });
                else cb(null, { stdout: '' });
            }
        );
        await runAndAssert(
            ['✅ Ruff: Passed', '✅ Mypy: Passed'],
            ['mypy --ignore-missing-imports']
        );
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
        await runAndAssert(
            ['❌ Biome: Lint errors'],
            [],
            false
        );
    });

    it('should always run semgrep', async () => {
        setupMocks(() => false, successHandler);
        await runAndAssert(
            ['✅ Semgrep: Secure'],
            ['semgrep scan']
        );
    });
});
