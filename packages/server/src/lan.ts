/**
 * Picking the address students should open.
 *
 * A lecture machine usually has several non-internal IPv4 addresses, and only
 * one of them is reachable from a phone in the room. On this developer's Mac,
 * for example:
 *
 *   en0        10.103.85.46     real Wi-Fi        <- the answer
 *   bridge100  10.211.55.2      Parallels VM net  <- unreachable from a phone
 *   bridge101  10.37.129.2      Parallels VM net  <- unreachable from a phone
 *
 * Taking "the first non-internal IPv4" is therefore a coin flip that silently
 * hands the class a dead URL. Instead every candidate is scored, and the
 * ranking is recomputed on each request so that moving between the office and
 * the lecture hall — or joining the room's Wi-Fi mid-class — is picked up with
 * no restart.
 */

import type os from 'node:os';
import { networkInterfaces } from 'node:os';

export interface LanCandidate {
  iface: string;
  address: string;
  score: number;
  /** Why it scored what it did; surfaced in `/api/join-url` for debugging. */
  note: string;
}

/**
 * Interfaces that exist on a normal machine but are never the route to a
 * phone: virtual machine bridges, container networks, VPN tunnels, and
 * Apple's peer-to-peer radios.
 */
const VIRTUAL_PREFIXES = [
  // macOS
  'bridge',                                    // Parallels / VMware / Docker host nets
  'vmnet', 'vboxnet', 'vnic',
  'awdl', 'llw', 'anpi', 'ap1',                // AirDrop / peer-to-peer / internal
  // Windows (Node reports the friendly name, e.g. "vEthernet (WSL)")
  'vethernet', 'hyper-v', 'vmware', 'virtualbox', 'loopback', 'bluetooth',
  'npcap', 'teredo', 'isatap',
  // Linux / containers
  'docker', 'veth', 'br-', 'virbr', 'cni', 'flannel',
  // VPN tunnels, all platforms
  'utun', 'ipsec', 'ppp', 'tun', 'tap', 'wg', 'tailscale', 'zerotier', 'zt',
  'nordlynx', 'proton', 'wireguard', 'openvpn',
];

/**
 * Physical interfaces, in rough order of "this is the room's Wi-Fi".
 *
 * Interface naming is per-platform: macOS uses `en0`/`en1`, Linux `wlan0`/`eth0`
 * or predictable names like `wlp3s0`, and Windows reports friendly names such
 * as `Wi-Fi` and `Ethernet 2`. All three have to be recognised or a Windows
 * laptop scores its real adapter no higher than a leftover virtual one.
 */
const PHYSICAL_PATTERNS: [RegExp, number, string][] = [
  // Windows friendly names
  [/^wi-?fi/i, 40, 'Wi-Fi adapter'],
  [/^(wireless|wlan)/i, 38, 'wireless adapter'],
  [/^ethernet/i, 28, 'ethernet adapter'],
  // macOS
  [/^en0$/i, 40, 'primary interface'],
  // Linux predictable names: wlp2s0 (wireless), enp0s3 / eno1 (wired)
  [/^wl\w+$/i, 38, 'wireless interface'],
  [/^(en|eth)\d+$/i, 30, 'wired/wireless interface'],
  [/^(enp|eno|ens)\w+$/i, 28, 'wired interface'],
];

function isPrivateLan(ip: string): boolean {
  if (ip.startsWith('192.168.')) return true;
  if (ip.startsWith('10.')) return true;
  const m = /^172\.(\d+)\./.exec(ip);
  return m ? Number(m[1]) >= 16 && Number(m[1]) <= 31 : false;
}

/**
 * Every usable candidate, best first.
 *
 * `table` is injectable so the ranking can be tested against interface layouts
 * from platforms the developer is not currently sitting on.
 */
export function rankLanCandidates(
  table: NodeJS.Dict<os.NetworkInterfaceInfo[]> = networkInterfaces(),
): LanCandidate[] {
  const out: LanCandidate[] = [];

  for (const [iface, addrs] of Object.entries(table)) {
    for (const addr of addrs ?? []) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      // Link-local means DHCP failed; nothing can route to it.
      if (addr.address.startsWith('169.254.')) continue;

      const lower = iface.toLowerCase();
      const virtual = VIRTUAL_PREFIXES.find((p) => lower.startsWith(p));

      let score = 0;
      const notes: string[] = [];

      if (virtual) {
        // Kept, but ranked below anything physical: on a machine with no real
        // network a VM bridge is still better than telling the class nothing.
        score -= 100;
        notes.push(`virtual interface (${virtual})`);
      } else {
        for (const [pattern, bonus, why] of PHYSICAL_PATTERNS) {
          if (pattern.test(iface)) {
            score += bonus;
            notes.push(why);
            break;
          }
        }
      }

      if (isPrivateLan(addr.address)) {
        score += 10;
        notes.push('private LAN range');
      } else {
        // A public address means the phone probably cannot reach it either.
        score -= 20;
        notes.push('not a private LAN range');
      }

      out.push({
        iface,
        address: addr.address,
        score,
        note: notes.join(', ') || 'unclassified',
      });
    }
  }

  return out.sort((a, b) => b.score - a.score || a.iface.localeCompare(b.iface));
}

/**
 * The address to hand the class.
 *
 * `LECTURE_LAN_IP` overrides everything, for the rooms where the automatic
 * choice is wrong (multi-homed machines, an AP on a second NIC).
 */
export function lanAddress(): string | null {
  const override = process.env.LECTURE_LAN_IP?.trim();
  if (override) return override;
  return rankLanCandidates()[0]?.address ?? null;
}
