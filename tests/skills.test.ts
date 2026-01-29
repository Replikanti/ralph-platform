import { listAvailableSkills } from '../src/agent';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('Skills Loading', () => {
    let testWorkDir: string;

    beforeEach(async () => {
        // Create a temporary workspace with skills
        testWorkDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ralph-skills-test-'));
        await fs.mkdir(path.join(testWorkDir, '.claude', 'skills', 'test-skill'), { recursive: true });
        await fs.writeFile(
            path.join(testWorkDir, '.claude', 'skills', 'test-skill', 'SKILL.md'),
            '---\nname: test-skill\ndescription: Test skill\n---\n# Test'
        );
    });

    afterEach(async () => {
        await fs.rm(testWorkDir, { recursive: true, force: true });
    });

    it('should detect skills in .claude/skills directory', async () => {
        const skills = await listAvailableSkills(testWorkDir);
        expect(skills).toContain('/test-skill');
    });

    it('should return empty message when no skills directory exists', async () => {
        const emptyWorkDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ralph-empty-'));
        const skills = await listAvailableSkills(emptyWorkDir);
        expect(skills).toBe('No native skills available.');
        await fs.rm(emptyWorkDir, { recursive: true, force: true });
    });
});
