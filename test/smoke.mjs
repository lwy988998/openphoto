import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const port = 39106;
const child = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT: String(port), OPENPHOTO_ACCESS_PASSWORD: 'smoke-test-password', OPENPHOTO_ENV_FILE: 'missing-test.env' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('服务启动超时')), 5000);
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('listening')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once('exit', (code) => reject(new Error(`服务提前退出：${code}`)));
  });
  const status = await fetch(`http://127.0.0.1:${port}/api/status`).then(response => response.json());
  const access = await fetch(`http://127.0.0.1:${port}/api/access`).then(response => response.json());
  assert.equal(status.app, 'openphoto-ai-color');
  assert.equal(access.authorized, false);
  console.log('SMOKE app=openphoto-ai-color unauthorized=false');
} finally {
  child.kill();
}
