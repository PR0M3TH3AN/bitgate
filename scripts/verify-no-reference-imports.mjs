#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FORBIDDEN_PATHS = [
  '/home/user/Documents/GitHub/bitvid',
  '/home/user/Documents/GitHub/bitroad'
];

async function checkImports(rootPath) {
  const pkgPath = join(rootPath, 'package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
  
  const violations = [];
  
  for (const workspace of pkg.workspaces || []) {
    const workspacePath = join(rootPath, workspace);
    const workspacePkgPath = join(workspacePath, 'package.json');
    const workspacePkg = JSON.parse(await readFile(workspacePkgPath, 'utf-8'));
    
    for (const dep of Object.keys(workspacePkg.dependencies || {})) {
      if (FORBIDDEN_PATHS.some(path => dep.startsWith(path))) {
        violations.push(`Workspace ${workspace} depends on forbidden path: ${dep}`);
      }
    }
  }
  
  if (violations.length > 0) {
    console.error('\nReference import violations detected:');
    violations.forEach(v => console.error(`- ${v}`));
    process.exit(1);
  }
  
  console.log('✓ No forbidden imports detected');
}

checkImports(fileURLToPath(new URL('.', import.meta.url))).catch(err => {
  console.error('Check failed:', err);
  process.exit(1);
});