import { AppError } from "./errors";

interface Ipv4Range {
  network: number;
  prefix: number;
}

const BLOCKED_IPV4_RANGES: Ipv4Range[] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["192.0.0.0", 24],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
].map(([address, prefix]) => ({
  network: ipv4ToInt(String(address)),
  prefix: Number(prefix),
}));

function reject(reason: string): never {
  throw new AppError("VALIDATION_ERROR", "URL not allowed", [
    { field: "url", message: reason },
  ]);
}

export function ipv4ToInt(address: string): number {
  const parts = address.split(".");
  if (parts.length !== 4) {
    throw new Error("Invalid IPv4 address");
  }
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/u.test(part)) {
      throw new Error("Invalid IPv4 address");
    }
    const octet = Number(part);
    if (octet > 255) {
      throw new Error("Invalid IPv4 address");
    }
    value = (value * 256 + octet) >>> 0;
  }
  return value;
}

export function ipv4InCidr(
  address: number,
  network: number,
  prefix: number,
): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return ((address & mask) >>> 0) === ((network & mask) >>> 0);
}

function blockedIpv4(address: number): boolean {
  return BLOCKED_IPV4_RANGES.some(({ network, prefix }) =>
    ipv4InCidr(address, network, prefix),
  );
}

function parseIpv6(raw: string): Uint8Array | null {
  let address = raw.toLowerCase();
  if (address.includes(".")) {
    const lastColon = address.lastIndexOf(":");
    if (lastColon === -1) {
      return null;
    }
    try {
      const ipv4 = ipv4ToInt(address.slice(lastColon + 1));
      const high = ((ipv4 >>> 16) & 0xffff).toString(16);
      const low = (ipv4 & 0xffff).toString(16);
      address = `${address.slice(0, lastColon)}:${high}:${low}`;
    } catch {
      return null;
    }
  }

  if ((address.match(/::/gu) ?? []).length > 1) {
    return null;
  }
  const [leftText, rightText] = address.split("::");
  if (leftText === undefined) {
    return null;
  }
  const left = leftText.length === 0 ? [] : leftText.split(":");
  const right = rightText === undefined || rightText.length === 0
    ? []
    : rightText.split(":");
  const hasCompression = rightText !== undefined;
  if (
    left.some((part) => !/^[0-9a-f]{1,4}$/u.test(part)) ||
    right.some((part) => !/^[0-9a-f]{1,4}$/u.test(part))
  ) {
    return null;
  }
  const missing = 8 - left.length - right.length;
  if ((hasCompression && missing < 1) || (!hasCompression && missing !== 0)) {
    return null;
  }
  const groups = [
    ...left,
    ...Array.from({ length: hasCompression ? missing : 0 }, () => "0"),
    ...right,
  ];
  if (groups.length !== 8) {
    return null;
  }
  const bytes = new Uint8Array(16);
  groups.forEach((group, index) => {
    const value = Number.parseInt(group, 16);
    bytes[index * 2] = value >>> 8;
    bytes[index * 2 + 1] = value & 0xff;
  });
  return bytes;
}

function ipv4FromBytes(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) * 0x1000000) +
    ((bytes[offset + 1] ?? 0) << 16) +
    ((bytes[offset + 2] ?? 0) << 8) +
    (bytes[offset + 3] ?? 0)
  ) >>> 0;
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte);
}

function embedsBlockedIpv4(address: Uint8Array): boolean {
  // Deprecated IPv4-compatible (::/96) and IPv4-mapped (::ffff:0:0/96)
  // literals are still interpreted by some network stacks.
  if (address.slice(0, 12).every((byte) => byte === 0)) {
    return blockedIpv4(ipv4FromBytes(address, 12));
  }
  if (
    address.slice(0, 10).every((byte) => byte === 0) &&
    address[10] === 0xff &&
    address[11] === 0xff
  ) {
    return blockedIpv4(ipv4FromBytes(address, 12));
  }

  // RFC 6052's well-known NAT64 prefix. Network-specific prefixes cannot be
  // inferred from a literal, but this prevents the standard representation
  // from translating a private/metadata IPv4 target after validation.
  if (hasPrefix(address, [0x00, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0])) {
    return blockedIpv4(ipv4FromBytes(address, 12));
  }

  // 6to4 encodes the destination IPv4 address immediately after 2002::/16.
  if (hasPrefix(address, [0x20, 0x02])) {
    return blockedIpv4(ipv4FromBytes(address, 2));
  }

  // Teredo carries a server IPv4 address followed by an XOR-obfuscated client
  // address. Reject either endpoint when it decodes to a non-public range.
  if (hasPrefix(address, [0x20, 0x01, 0x00, 0x00])) {
    const server = ipv4FromBytes(address, 4);
    const client = (~ipv4FromBytes(address, 12)) >>> 0;
    return blockedIpv4(server) || blockedIpv4(client);
  }

  // ISATAP can appear below an arbitrary IPv6 prefix; its interface identifier
  // has 0000:5efe or 0200:5efe followed by the embedded IPv4 address.
  if (
    (hasPrefix(address.slice(8), [0x00, 0x00, 0x5e, 0xfe]) ||
      hasPrefix(address.slice(8), [0x02, 0x00, 0x5e, 0xfe])) &&
    blockedIpv4(ipv4FromBytes(address, 12))
  ) {
    return true;
  }

  return false;
}

function isBlockedIpv6(address: string): boolean {
  const bytes = parseIpv6(address);
  if (bytes === null) {
    return true;
  }
  const allZero = bytes.every((byte) => byte === 0);
  if (allZero) {
    return true;
  }
  const loopback = bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1;
  if (loopback) {
    return true;
  }
  if (((bytes[0] ?? 0) & 0xfe) === 0xfc) {
    return true;
  }
  if (bytes[0] === 0xfe && ((bytes[1] ?? 0) & 0xc0) === 0x80) {
    return true;
  }
  // Deprecated site-local addresses (fec0::/10) remain non-public even though
  // RFC 3879 removed their standard meaning.
  if (bytes[0] === 0xfe && ((bytes[1] ?? 0) & 0xc0) === 0xc0) {
    return true;
  }
  // IPv6 multicast and the local-use NAT64 prefix are never public monitor
  // destinations. The latter is reserved by RFC 8215 as 64:ff9b:1::/48.
  if (
    bytes[0] === 0xff ||
    hasPrefix(bytes, [0x00, 0x64, 0xff, 0x9b, 0x00, 0x01])
  ) {
    return true;
  }
  return embedsBlockedIpv4(bytes);
}

export interface SafeExternalUrlPolicy {
  /** Uptime monitors must never be usable to call the Zenguy control plane. */
  denyZenguyOrigins?: boolean;
  /** Credential-bearing requests may not use cleartext HTTP. */
  requireHttps?: boolean;
}

export function assertSafeExternalUrl(
  raw: string,
  policy: SafeExternalUrlPolicy = {},
): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return reject("URL is invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return reject("Only HTTP and HTTPS URLs are allowed");
  }
  if (policy.requireHttps === true && url.protocol !== "https:") {
    return reject("HTTPS is required for this URL");
  }
  if (url.username.length > 0 || url.password.length > 0) {
    return reject("Embedded URL credentials are not allowed");
  }
  if (url.port === "0") {
    return reject("Port 0 is not allowed");
  }

  const hostname = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/gu, "")
    .replace(/\.+$/gu, "");
  if (
    policy.denyZenguyOrigins === true &&
    (hostname === "zenguy.com" || hostname.endsWith(".zenguy.com"))
  ) {
    return reject("Zenguy service origins are not allowed");
  }
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "local" ||
    hostname.endsWith(".local") ||
    hostname === "internal" ||
    hostname.endsWith(".internal") ||
    hostname === "metadata.google.internal"
  ) {
    return reject("Local and internal hostnames are not allowed");
  }

  if (hostname.includes(":")) {
    if (isBlockedIpv6(hostname)) {
      return reject("Private or reserved IP addresses are not allowed");
    }
  } else {
    let ipv4: number | null = null;
    try {
      ipv4 = ipv4ToInt(hostname);
    } catch {
      // Workers cannot pre-resolve DNS: DNS-rebinding residual risk is accepted for V1.
      // Hostnames are revalidated at every navigation/redirect boundary.
    }
    if (ipv4 !== null && blockedIpv4(ipv4)) {
      return reject("Private or reserved IP addresses are not allowed");
    }
  }

  return url;
}
