const { execSync } = require('child_process');
const fs = require('fs');

try {
    const output = execSync('git diff --name-only main', { cwd: 'd:\\skribl' }).toString();
    fs.writeFileSync('d:\\skribl\\git_diff_output.txt', output);
    console.log('Successfully wrote git diff to git_diff_output.txt');
} catch (e) {
    console.error('Error running git diff:', e.message);
    if (e.stdout) console.log(e.stdout.toString());
    if (e.stderr) console.error(e.stderr.toString());
}
