// Ranks synthetic interface tables from each platform, so the "which address do
// students open" logic can be checked without that machine in front of you.
import { rankLanCandidates } from '../src/lan.ts';

const CASES = {
  'macOS + Parallels (this dev machine)': {
    lo0:        [{ family: 'IPv4', address: '127.0.0.1',     internal: true }],
    en0:        [{ family: 'IPv4', address: '10.103.85.46',  internal: false }],
    bridge100:  [{ family: 'IPv4', address: '10.211.55.2',   internal: false }],
    bridge101:  [{ family: 'IPv4', address: '10.37.129.2',   internal: false }],
  },
  'Windows laptop (Wi-Fi + WSL + dead ethernet)': {
    'Wi-Fi':                       [{ family: 'IPv4', address: '192.168.0.24', internal: false }],
    'vEthernet (WSL)':             [{ family: 'IPv4', address: '172.28.16.1',  internal: false }],
    'Ethernet 2':                  [{ family: 'IPv4', address: '169.254.9.1',  internal: false }],
    'Loopback Pseudo-Interface 1': [{ family: 'IPv4', address: '127.0.0.1',    internal: true }],
  },
  'Windows desktop (Hyper-V + ethernet)': {
    'Ethernet':                   [{ family: 'IPv4', address: '192.168.1.50', internal: false }],
    'vEthernet (Default Switch)': [{ family: 'IPv4', address: '172.20.1.1',   internal: false }],
  },
  'Linux (wifi + docker + wired)': {
    wlp3s0:  [{ family: 'IPv4', address: '10.0.0.7',    internal: false }],
    docker0: [{ family: 'IPv4', address: '172.17.0.1',  internal: false }],
    eno1:    [{ family: 'IPv4', address: '192.168.5.3', internal: false }],
  },
  'VPN active (should not win)': {
    en0:    [{ family: 'IPv4', address: '192.168.4.11', internal: false }],
    utun3:  [{ family: 'IPv4', address: '10.8.0.6',     internal: false }],
    'Tailscale': [{ family: 'IPv4', address: '100.64.0.3', internal: false }],
  },
};

const EXPECTED = {
  'macOS + Parallels (this dev machine)': '10.103.85.46',
  'Windows laptop (Wi-Fi + WSL + dead ethernet)': '192.168.0.24',
  'Windows desktop (Hyper-V + ethernet)': '192.168.1.50',
  'Linux (wifi + docker + wired)': '10.0.0.7',
  'VPN active (should not win)': '192.168.4.11',
};

let failures = 0;
for (const [name, table] of Object.entries(CASES)) {
  const ranked = rankLanCandidates(table);
  const chosen = ranked[0]?.address ?? null;
  const want = EXPECTED[name];
  const ok = chosen === want;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  console.log(`        chose ${chosen}${ok ? '' : `  (expected ${want})`}`);
  for (const c of ranked) {
    console.log(`        ${String(c.score).padStart(4)}  ${c.iface.padEnd(30)} ${c.address.padEnd(15)} ${c.note}`);
  }
}
console.log(failures ? `\n${failures} case(s) failed` : '\nall cases passed');
process.exit(failures ? 1 : 0);
