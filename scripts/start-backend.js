const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const backendRoot = path.join(projectRoot, 'backend');
const port = Number(process.env.PORT || 5000);

function checkExistingBackend() {
  return new Promise((resolve, reject) => {
    const request = http.get({
      hostname: '127.0.0.1',
      port,
      path: '/api/health',
      timeout: 1500,
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        let payload;
        try {
          payload = JSON.parse(body);
        } catch {
          resolve({ reachable: true, isAttendanceApi: false });
          return;
        }
        resolve({
          reachable: true,
          isAttendanceApi: payload.service === 'College Attendance Management API',
        });
      });
    });

    request.on('timeout', () => request.destroy(new Error('API health check timed out.')));
    request.on('error', (error) => {
      if (error.code === 'ECONNREFUSED') {
        resolve({ reachable: false, isAttendanceApi: false });
      } else {
        reject(error);
      }
    });
  });
}

async function startBackend() {
  const existing = await checkExistingBackend();
  if (existing.isAttendanceApi) {
    console.log(`[backend] Attendance API is already running on port ${port}; reusing it.`);
    return;
  }
  if (existing.reachable) {
    throw new Error(`Port ${port} is responding, but it is not the attendance API.`);
  }

  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const backend = spawn(command, ['run', 'dev'], {
    cwd: backendRoot,
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  backend.on('error', (error) => {
    console.error('[backend] Failed to start:', error.message);
    process.exitCode = 1;
  });
  backend.on('exit', (code) => {
    process.exitCode = code === 0 ? 0 : code || 1;
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => backend.kill(signal));
  }
}

startBackend().catch((error) => {
  console.error(`[backend] ${error.message}`);
  process.exitCode = 1;
});
