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
  const mapped =
    bytes.slice(0, 10).every((byte) => byte === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff;
  if (mapped) {
    const ipv4 =
      (((bytes[12] ?? 0) * 0x1000000) +
        ((bytes[13] ?? 0) << 16) +
        ((bytes[14] ?? 0) << 8) +
        (bytes[15] ?? 0)) >>>
      0;
    return blockedIpv4(ipv4);
  }
  return false;
}

export function assertSafeExternalUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return reject("URL is invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return reject("Only HTTP and HTTPS URLs are allowed");
  }
  if (url.username.length > 0 || url.password.length > 0) {
    return reject("Embedded URL credentials are not allowed");
  }
  if (url.port === "0") {
    return reject("Port 0 is not allowed");
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
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
