// Mock Ts.ED decorators
jest.mock('@tsed/common', () => ({
    Service: () => (target: any) => target,
    Inject: () => (target: any, propertyKey: string) => {},
}));

jest.mock('@tsed/logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    })),
}));

// Mock fs/promises
const mockReadFile = jest.fn();
const mockStat = jest.fn();
jest.mock('node:fs/promises', () => ({
    readFile: mockReadFile,
    stat: mockStat,
}));

// Mock config/env
let mockRepoConfigPath = '/etc/ralph/config/repos.json';
let mockDefaultRepoUrl = 'https://github.com/default/repo';
let mockLinearTeamReposJson = '{}';

jest.mock('../../src/config/env', () => ({
    get REPO_CONFIG_PATH() {
        return mockRepoConfigPath;
    },
    get DEFAULT_REPO_URL() {
        return mockDefaultRepoUrl;
    },
    get LINEAR_TEAM_REPOS_JSON() {
        return mockLinearTeamReposJson;
    },
}));

import { ConfigService } from '../../src/services/ConfigService';

describe('ConfigService', () => {
    let service: ConfigService;
    let mockRedis: any;

    beforeEach(() => {
        jest.clearAllMocks();

        // Setup default mocks
        mockRepoConfigPath = '/etc/ralph/config/repos.json';
        mockDefaultRepoUrl = 'https://github.com/default/repo';
        mockLinearTeamReposJson = '{}';

        mockRedis = {
            connection: {
                get: jest.fn().mockResolvedValue(null),
                set: jest.fn().mockResolvedValue('OK'),
            },
        };

        service = new ConfigService();
        (service as any).redis = mockRedis;

        // Default: file exists with valid content
        mockStat.mockResolvedValue({ mtimeMs: 1234567890 });
        mockReadFile.mockResolvedValue(JSON.stringify({
            FRONTEND: 'https://github.com/org/frontend',
            BACKEND: 'https://github.com/org/backend',
        }));
    });

    describe('getRepoForTeam - ConfigMap file resolution', () => {
        it('should load config from file when Redis cache is empty', async () => {
            const result = await service.getRepoForTeam('FRONTEND');

            expect(result).toBe('https://github.com/org/frontend');
            expect(mockReadFile).toHaveBeenCalledWith('/etc/ralph/config/repos.json', 'utf-8');
            expect(mockRedis.connection.set).toHaveBeenCalledWith(
                'ralph:config:repos',
                expect.stringContaining('frontend')
            );
            expect(mockRedis.connection.set).toHaveBeenCalledWith(
                'ralph:config:version',
                '1234567890'
            );
        });

        it('should use Redis cache when version matches', async () => {
            mockRedis.connection.get.mockImplementation(async (key: string) => {
                if (key === 'ralph:config:repos') {
                    return JSON.stringify({
                        CACHED: 'https://github.com/org/cached',
                    });
                }
                if (key === 'ralph:config:version') {
                    return '1234567890';
                }
                return null;
            });

            const result = await service.getRepoForTeam('CACHED');

            expect(result).toBe('https://github.com/org/cached');
            expect(mockReadFile).not.toHaveBeenCalled();
        });

        it('should refresh cache when file version changed', async () => {
            mockRedis.connection.get.mockImplementation(async (key: string) => {
                if (key === 'ralph:config:repos') {
                    return JSON.stringify({ OLD: 'https://github.com/org/old' });
                }
                if (key === 'ralph:config:version') {
                    return '9999999'; // Old version
                }
                return null;
            });

            mockStat.mockResolvedValue({ mtimeMs: 1234567890 }); // New version

            const result = await service.getRepoForTeam('FRONTEND');

            expect(result).toBe('https://github.com/org/frontend');
            expect(mockReadFile).toHaveBeenCalled();
            expect(mockRedis.connection.set).toHaveBeenCalledWith(
                'ralph:config:version',
                '1234567890'
            );
        });

        it('should fall back to Redis if file read fails', async () => {
            mockRedis.connection.get.mockImplementation(async (key: string) => {
                if (key === 'ralph:config:repos') {
                    return JSON.stringify({
                        FALLBACK: 'https://github.com/org/fallback',
                    });
                }
                if (key === 'ralph:config:version') {
                    return '999';
                }
                return null;
            });

            mockReadFile.mockRejectedValue(new Error('File not found'));

            const result = await service.getRepoForTeam('FALLBACK');

            expect(result).toBe('https://github.com/org/fallback');
        });

        it('should handle missing file gracefully', async () => {
            mockStat.mockRejectedValue(new Error('ENOENT'));
            mockReadFile.mockRejectedValue(new Error('ENOENT'));

            const result = await service.getRepoForTeam('FRONTEND');

            // Should fall back to default
            expect(result).toBe('https://github.com/default/repo');
        });
    });

    describe('getRepoForTeam - Environment variable fallback', () => {
        it('should fall back to LINEAR_TEAM_REPOS_JSON env var', async () => {
            mockLinearTeamReposJson = JSON.stringify({
                ENV_TEAM: 'https://github.com/org/env-team',
            });

            mockStat.mockRejectedValue(new Error('ENOENT'));
            mockReadFile.mockRejectedValue(new Error('ENOENT'));

            const result = await service.getRepoForTeam('ENV_TEAM');

            expect(result).toBe('https://github.com/org/env-team');
        });

        it('should handle invalid LINEAR_TEAM_REPOS_JSON', async () => {
            mockLinearTeamReposJson = 'invalid json{';

            mockStat.mockRejectedValue(new Error('ENOENT'));
            mockReadFile.mockRejectedValue(new Error('ENOENT'));

            const result = await service.getRepoForTeam('ANY_TEAM');

            // Should fall back to default
            expect(result).toBe('https://github.com/default/repo');
        });
    });

    describe('getRepoForTeam - Default fallback', () => {
        it('should return DEFAULT_REPO_URL when team not found', async () => {
            const result = await service.getRepoForTeam('UNKNOWN_TEAM');

            expect(result).toBe('https://github.com/default/repo');
        });

        it('should return null if no defaults configured', async () => {
            mockDefaultRepoUrl = '';

            const result = await service.getRepoForTeam('UNKNOWN_TEAM');

            expect(result).toBeNull();
        });

        it('should return default when teamKey is undefined', async () => {
            const result = await service.getRepoForTeam(undefined);

            expect(result).toBe('https://github.com/default/repo');
        });
    });

    describe('Error handling', () => {
        it('should handle Redis connection errors gracefully', async () => {
            mockRedis.connection.get.mockRejectedValue(new Error('Redis connection lost'));

            const result = await service.getRepoForTeam('FRONTEND');

            // Should fall back to default
            expect(result).toBe('https://github.com/default/repo');
        });

        it('should handle Redis set errors gracefully', async () => {
            mockRedis.connection.set.mockRejectedValue(new Error('Redis write failed'));

            const result = await service.getRepoForTeam('FRONTEND');

            // Should still return the correct value
            expect(result).toBe('https://github.com/org/frontend');
        });
    });
});
