const os = require('os');
const net = require('net');
const dgram = require('dgram');
const path = require('path');
const { spawn } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const mobileRoot = path.join(projectRoot, 'mobile');

function isUsableAddress(address) {
  return net.isIP(address) === 4 && !address.startsWith('127.') && !address.startsWith('169.254.');
}

function getFallbackLanAddress() {
  const candidates = [];
  for (const [name, interfaces] of Object.entries(os.networkInterfaces())) {
    for (const address of interfaces || []) {
      if ((address.family === 'IPv4' || address.family === 4) &&
          !address.internal &&
          isUsableAddress(address.address)) {
        candidates.push({
          address: address.address,
          preferred: /wi-?fi|wireless|ethernet/i.test(name),
        });
      }
    }
  }
  candidates.sort((a, b) => Number(b.preferred) - Number(a.preferred));
  return candidates.length ? candidates[0].address : 'localhost';
}

function getLanAddress() {
  const override = process.env.ATTENDANCE_LAN_IP?.trim();
  if (override) {
    if (!isUsableAddress(override)) {
      throw new Error('ATTENDANCE_LAN_IP must be a reachable IPv4 address for this computer.');
    }
    return Promise.resolve(override);
  }

  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    let settled = false;
    const finish = (address) => {
      if (settled) return;
      settled = true;
      socket.close();
      resolve(address);
    };

    socket.once('error', () => finish(getFallbackLanAddress()));
    socket.connect(53, '1.1.1.1', () => {
      const address = socket.address().address;
      finish(isUsableAddress(address) ? address : getFallbackLanAddress());
    });
  });
}

const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function findExpoPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '0.0.0.0', () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function start() {
  const expoPort = await findExpoPort();
  const lanAddress = await getLanAddress();
  const configuredApiUrl = process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/+$/, '');
  const apiBaseUrl = configuredApiUrl || `http://${lanAddress}:5000/api`;
  const env = {
    ...process.env,
    EXPO_PORT: String(expoPort),
    EXPO_LAN_HOST: lanAddress,
    EXPO_PUBLIC_API_URL: apiBaseUrl,
    CI: 'false',
    FORCE_COLOR: '1',
    TERM: 'xterm-256color',
  };
  const qr = spawn(process.execPath, [path.join(__dirname, 'open-browser.js')], {
    cwd: projectRoot,
    env,
    stdio: 'inherit',
  });
  const expoArgs = ['exec', '--', 'expo', 'start', '--lan', '--port', String(expoPort)];
  for (const flag of ['--web', '--android', '--ios']) {
    if (process.argv.includes(flag)) expoArgs.push(flag);
  }
  const expo = spawn(command, expoArgs, {
    cwd: mobileRoot,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  console.log(`\n[expo] Backend API: ${apiBaseUrl}`);
  console.log(`[expo] Keep this phone and computer on the same Wi-Fi network.\n`);
  if (!configuredApiUrl && lanAddress === 'localhost') {
    console.warn('[expo] No LAN IPv4 address was found. Set ATTENDANCE_LAN_IP to the computer Wi-Fi IPv4 address for a physical phone.');
  }

  expo.on('error', (error) => {
    qr.kill();
    console.error('[expo] Failed to start Expo:', error);
    process.exitCode = 1;
  });
  expo.on('exit', (code) => {
    qr.kill();
    process.exit(code ?? 0);
  });
}

start().catch((error) => {
  console.error('[expo] Could not find an available port:', error);
  process.exitCode = 1;
});
