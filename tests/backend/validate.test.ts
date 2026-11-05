import { describe, expect, it } from "vitest";
import {
  cleanBackupId,
  cleanPathUnder,
  cleanSiteName,
  cleanSpec,
  parseSiteKey,
} from "../../src/backend/validate.js";

const base = { type: "static", names: ["example.com"], root: "/var/www/a" };

describe("site names", () => {
  it("takes plain names and refuses the rest", () => {
    expect(cleanSiteName("my-site.example")).toBe("my-site.example");
    for (const bad of ["", "../etc", "a b", "a;b", "x.conf", "-x", "a/b"]) {
      expect(() => cleanSiteName(bad)).toThrow();
    }
  });

  it("splits a site key", () => {
    expect(parseSiteKey("nginx:default")).toEqual({
      server: "nginx",
      name: "default",
    });
    expect(() => parseSiteKey("iis:x")).toThrow();
    expect(() => parseSiteKey("nginx")).toThrow();
  });
});

describe("site form", () => {
  it("fills in defaults", () => {
    const spec = cleanSpec(base, "nginx");
    expect(spec).toMatchObject({
      port: 80,
      httpsPort: 443,
      index: "index.html index.htm",
      gzip: true,
      accessLog: true,
    });
  });

  it("refuses text that could break out of the config", () => {
    const bad = [
      { ...base, names: ["example.com; return 200"] },
      { ...base, names: ["a b"] },
      { ...base, root: "/var/www/a; include /etc/passwd" },
      { ...base, root: "/etc/nginx" },
      { ...base, root: "/var/www/../../etc" },
      { ...base, index: "index.html;" },
      { type: "proxy", names: ["a.com"], upstream: "http://x:1/;evil" },
      { type: "proxy", names: ["a.com"], upstream: "file:///etc/passwd" },
      { type: "redirect", names: ["a.com"], redirectTo: "https://x.com/$host" },
      {
        type: "php",
        names: ["a.com"],
        root: "/var/www/a",
        phpSocket: "/run/x",
      },
      { ...base, type: "nope" },
      { ...base, names: [] },
      { ...base, port: 0 },
      { ...base, maxBodyMb: -1 },
    ];
    for (const input of bad) {
      expect(() => cleanSpec(input, "nginx"), JSON.stringify(input)).toThrow();
    }
  });

  it("needs certificate files for HTTPS outside Caddy", () => {
    expect(() => cleanSpec({ ...base, https: true }, "nginx")).toThrow(
      /certificate/,
    );
    expect(cleanSpec({ ...base, https: true }, "caddy").https).toBe(true);
  });

  it("refuses the nginx catch all name on Caddy", () => {
    expect(cleanSpec({ ...base, names: ["_"] }, "nginx").names).toEqual(["_"]);
    expect(() => cleanSpec({ ...base, names: ["_"] }, "caddy")).toThrow();
  });
});

describe("paths", () => {
  it("keeps paths under their root", () => {
    expect(cleanPathUnder("/etc/nginx/nginx.conf", ["/etc/nginx"])).toBe(
      "/etc/nginx/nginx.conf",
    );
    for (const bad of [
      "/etc/nginx2/x",
      "/etc/nginx/../shadow",
      "etc/nginx/x",
      "/etc/nginx/a b",
      "/etc/nginx//x",
    ]) {
      expect(() => cleanPathUnder(bad, ["/etc/nginx"])).toThrow();
    }
  });

  it("takes only numeric backup ids", () => {
    expect(cleanBackupId("1762336800")).toBe("1762336800");
    expect(() => cleanBackupId("1762336800; rm")).toThrow();
  });
});
