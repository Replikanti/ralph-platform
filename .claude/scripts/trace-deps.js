#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const targetFile = process.argv[2];
if (!targetFile) {
    console.error("Usage: node trace-deps.js <filename>");
    process.exit(1);
}

const fileName = path.basename(targetFile, path.extname(targetFile));

try {
    // Naive regex search for imports of this file
    // Finds: import ... from './fileName' or require('./fileName')
    const cmd = `grep -r "${fileName}" . --include="*.ts" --include="*.js" --exclude-dir=node_modules --exclude-dir=dist`;
    const output = execSync(cmd).toString();
    
    const files = new Set();
    output.split('\n').forEach(line => {
        if (line.trim()) {
            const file = line.split(':')[0];
            files.add(file);
        }
    });

    console.log(`Files depending on ${targetFile}:`);
    if (files.size === 0) {
        console.log("No dependencies found.");
    } else {
        files.forEach(f => console.log(`- ${f}`));
    }

} catch (e) {
    // Grep returns 1 if no matches found
    console.log(`No dependencies found for ${targetFile}.`);
}

