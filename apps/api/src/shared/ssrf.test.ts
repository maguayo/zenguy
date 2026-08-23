import { AppError } from "./errors";
import { assertSafeExternalUrl, ipv4InCidr, ipv4ToInt } from "./ssrf";

describe("assertSafeExternalUrl", () => {
  it.each([
    "not a url",
    "ftp://example.com/file",
    "https://user:password@example.com/",
    "http://localhost/",
    "http://localhost./",
    "http://api.localhost/",
    "http://service.local/",
    "http://service.internal/",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://127.0.0.1/",
    "http://2130706433/",
    "http://0x7f000001/",
    "http://10.4.3.2/",
    "http://100.64.0.1/",
    "http://169.254.169.254/",
    "http://172.31.255.255/",
    "http://192.168.1.1/",
    "http://192.0.0.10/",
    "http://198.18.0.1/",
    "http://224.0.0.1/",
    "http://240.0.0.1/",
    "http://[::]/",
    "http://[::1]/",
    "http://[fc00::1]/",
    "http://[fdff::1]/",
    "http://[fe80::1]/",
    "http://[fec0::1]/",
    "http://[feff::1]/",
    "http://[ff02::1]/",
    "http://[::127.0.0.1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[64:ff9b::127.0.0.1]/",
    "http://[64:ff9b:1::8.8.8.8]/",
    "http://[2002:7f00:1::1]/",
    "http://[2001:0:7f00:1:0:0:c000:221]/",
    "http://[2001:0:808:808:0:0:80ff:fffe]/",
    "http://[2001:db8::5efe:127.0.0.1]/",
    "http://example.com:0/",
  ])("blocks %s", (raw) => {
    expect(() => assertSafeExternalUrl(raw)).toThrowError(AppError);
    try {
      assertSafeExternalUrl(raw);
    } catch (error) {
      expect(error).toMatchObject({
        code: "VALIDATION_ERROR",
        message: "URL not allowed",
      });
    }
  });

  it.each([
    "https://example.com",
    "http://example.com:8080/x?y=1",
    "https://8.8.8.8/dns-query",
    "https://[2606:4700:4700::1111]/",
    "https://subdomain.example.com/path",
    "https://bücher.example/catalogue",
    "http://100.63.255.255/",
    "http://[::ffff:8.8.8.8]/",
    "http://[64:ff9b::8.8.8.8]/",
    "http://[2002:808:808::1]/",
  ])("allows %s", (raw) => {
    expect(assertSafeExternalUrl(raw)).toBeInstanceOf(URL);
  });

  it("normalizes an internationalized hostname to punycode", () => {
    expect(assertSafeExternalUrl("https://bücher.example/").hostname).toBe(
      "xn--bcher-kva.example",
    );
  });

  it("can enforce monitor-only service-origin and HTTPS policy", () => {
    expect(() =>
      assertSafeExternalUrl("https://api.zenguy.com/health", {
        denyZenguyOrigins: true,
      }),
    ).toThrowError(AppError);
    expect(() =>
      assertSafeExternalUrl("https://api.zenguy.com./health", {
        denyZenguyOrigins: true,
      }),
    ).toThrowError(AppError);
    expect(() =>
      assertSafeExternalUrl("http://example.com/health", {
        requireHttps: true,
      }),
    ).toThrowError(AppError);
    expect(
      assertSafeExternalUrl("https://example.com/health", {
        denyZenguyOrigins: true,
        requireHttps: true,
      }).origin,
    ).toBe("https://example.com");
    // Browser-test validation uses the default policy and is intentionally
    // independent from the uptime control-plane denylist.
    expect(assertSafeExternalUrl("https://app.zenguy.com")).toBeInstanceOf(URL);
  });
});

describe("IPv4 helpers", () => {
  it("converts addresses and checks CIDR membership", () => {
    expect(ipv4ToInt("127.0.0.1")).toBe(2_130_706_433);
    expect(
      ipv4InCidr(ipv4ToInt("172.31.1.2"), ipv4ToInt("172.16.0.0"), 12),
    ).toBe(true);
    expect(
      ipv4InCidr(ipv4ToInt("172.32.1.2"), ipv4ToInt("172.16.0.0"), 12),
    ).toBe(false);
  });
});
