#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const IGNORE_DIRS = new Set(['node_modules', 'dist', '.git', '.claude-home', 'coverage']);
const IGNORE_FILES = new Set(['package-lock.json', '.DS_Store']);

function printTree(dir, prefix = '') {
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        // Sort: directories first, then files
        entries.sort((a, b) => {
            if (a.isDirectory() && !b.isDirectory()) return -1;
            if (!a.isDirectory() && b.isDirectory()) return 1;
            return a.name.localeCompare(b.name);
        });

        for (const entry of entries) {
            if (entry.isDirectory()) {
                if (IGNORE_DIRS.has(entry.name)) continue;
                console.log(`${prefix}${entry.name}:`);
                printTree(path.join(dir, entry.name), prefix + '  ');
            } else {
                if (IGNORE_FILES.has(entry.name)) continue;
                console.log(`${prefix}${entry.name}`);
            }
        }
    } catch (e) {
        // Ignore permission errors etc.
    }
}

console.log("root:");
printTree(process.cwd(), '  ');
