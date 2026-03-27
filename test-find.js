import fs from 'fs';
const dir = fs.readdirSync('src/app/dependency-factory');
for (const f of dir) {
  if (f.endsWith('.ts')) {
    const text = fs.readFileSync('src/app/dependency-factory/' + f, 'utf8');
    if (text.includes('ProviderRunner')) {
      console.log('Found in', f);
    }
  }
}
