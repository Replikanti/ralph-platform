#!/usr/bin/env node
const { spawn } = require('child_process');

console.log("Running tests... (filtering output)");

const child = spawn('npm', ['test'], { 
    env: { ...process.env, CI: 'true' },
    shell: true 
});

let buffer = '';

child.stdout.on('data', (data) => {
    buffer += data.toString();
});

child.stderr.on('data', (data) => {
    buffer += data.toString();
});

child.on('close', (code) => {
    if (code === 0) {
        console.log("✅ All tests passed!");
    } else {
        console.log("❌ Tests failed. Filtered errors:");
        const lines = buffer.split('\n');
        let printing = false;
        for (const line of lines) {
            // Simple heuristic to show relevant error parts
            if (line.includes('FAIL') || line.includes('Error:') || line.includes('●')) {
                printing = true;
            }
            if (printing) {
                // Skip npm noise
                if (!line.includes('npm ERR!')) console.log(line);
            }
        }
    }
});
