import { runPolyglotValidation, listFiles, readFile, writeFile, runCommand } from '../src/tools';
import * as child_process from 'node:child_process';
import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import path from 'node:path';

// Mock child_process and fs
jest.mock('node:child_process');
jest.mock('node:fs');
jest.mock('node:fs/promises');

const mockedExec = child_process.exec as unknown as jest.Mock;
const mockedFsExistsSync = fs.existsSync as unknown as jest.Mock;
const mockedFsReaddir = fsPromises.readdir as unknown as jest.Mock;
const mockedFsReadFile = fsPromises.readFile as unknown as jest.Mock;
const mockedFsWriteFile = fsPromises.writeFile as unknown as jest.Mock;
const mockedFsMkdir = fsPromises.mkdir as unknown as jest.Mock;

describe('Agent Tools', () => {
    const workDir = '/mock/workspace';

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('listFiles should return formatted file list', async () => {
        mockedFsReaddir.mockResolvedValue([
            { name: 'file.txt', isDirectory: () => false },
            { name: 'src', isDirectory: () => true }
        ]);
        const result = await listFiles(workDir, '.');
        expect(result).toBe('file.txt\nsrc/');
        expect(mockedFsReaddir).toHaveBeenCalledWith(path.resolve(workDir, '.'), { withFileTypes: true });
    });

    it('readFile should return file content', async () => {
        mockedFsReadFile.mockResolvedValue('content');
        const result = await readFile(workDir, 'file.txt');
        expect(result).toBe('content');
        expect(mockedFsReadFile).toHaveBeenCalledWith(path.resolve(workDir, 'file.txt'), 'utf-8');
    });

    it('writeFile should write content to file', async () => {
        await writeFile(workDir, 'file.txt', 'content');
        expect(mockedFsMkdir).toHaveBeenCalledWith(workDir, { recursive: true });
        expect(mockedFsWriteFile).toHaveBeenCalledWith(path.resolve(workDir, 'file.txt'), 'content', 'utf-8');
    });

    it('runCommand should execute command and return output', async () => {
        mockedExec.mockImplementation((cmd: string, opts: any, cb: any) => cb(null, { stdout: 'out', stderr: 'err' }));
        // Note: runCommand uses promisified exec, which we need to mock properly.
        // Since we mocked 'node:child_process', promisify(exec) will wrap the mock.
        // Custom mock for promisified exec might be needed or just rely on cb style if promisify handles it.
        // Actually, 'util.promisify' wraps the function. If we mock 'exec' to call callback, it works.
        const result = await runCommand(workDir, 'echo hello');
        expect(result).toContain('STDOUT:\nout');
        expect(result).toContain('STDERR:\nerr');
    });

    it('should prevent path traversal attacks', async () => {
        await expect(readFile(workDir, '../secret')).rejects.toThrow('Access denied');
        await expect(writeFile(workDir, '../secret', '')).rejects.toThrow('Access denied');
    });
});

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
        expect(result.success).toBe(expectSuccess);

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
