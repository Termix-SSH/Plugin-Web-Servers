import { describe, expect, it } from "vitest";
import { serverPaths } from "../../src/backend/servers.js";
import { dropSpec, readSpec, renderSite } from "../../src/backend/templates.js";
import { cleanSpec } from "../../src/backend/validate.js";
import type { ServerInfo, ServerKind } from "../../src/shared/types.js";

const server = (kind: ServerKind, layout: ServerInfo["layout"] = "debian") =>
  ({
    ...serverPaths(kind, kind === "caddy" ? "caddy" : layout),
    installed: true,
    version: "1",
    state: "active",
    boot: true,
  }) as ServerInfo;

const spec = (kind: ServerKind, over: Record<string, unknown> = {}) =>
  cleanSpec(
    {
      type: "static",
      names: ["example.com", "www.example.com"],
      root: "/var/www/example",
      ...over,
    },
    kind,
  );

describe("nginx", () => {
  it("renders a static site", () => {
    const out = renderSite(server("nginx"), "example", spec("nginx")).content;
    expect(out).toContain("listen 80;");
    expect(out).toContain("server_name example.com www.example.com;");
    expect(out).toContain("root /var/www/example;");
    expect(out).toContain("try_files $uri $uri/ =404;");
    expect(out).toContain("access_log /var/log/nginx/example.access.log;");
    expect(out).toContain("gzip on;");
  });

  it("renders a proxy with HTTPS and a redirect from HTTP", () => {
    const out = renderSite(
      server("nginx"),
      "app",
      spec("nginx", {
        type: "proxy",
        upstream: "http://127.0.0.1:3000",
        https: true,
        certPath: "/etc/ssl/a.pem",
        keyPath: "/etc/ssl/a.key",
        maxBodyMb: 50,
      }),
    ).content;
    expect(out).toContain("return 301 https://$host$request_uri;");
    expect(out).toContain("listen 443 ssl;");
    expect(out).toContain("ssl_certificate /etc/ssl/a.pem;");
    expect(out).toContain("proxy_pass http://127.0.0.1:3000;");
    expect(out).toContain("proxy_set_header Upgrade $http_upgrade;");
    expect(out).toContain("client_max_body_size 50m;");
  });

  it("renders PHP and a redirect", () => {
    const php = renderSite(
      server("nginx"),
      "shop",
      spec("nginx", { type: "php", phpSocket: "/run/php/php8.4-fpm.sock" }),
    ).content;
    expect(php).toContain("fastcgi_pass unix:/run/php/php8.4-fpm.sock;");
    expect(php).toContain("index index.php index.html;");
    const redirect = renderSite(
      server("nginx"),
      "old",
      spec("nginx", {
        type: "redirect",
        redirectTo: "https://new.example.com/",
      }),
    ).content;
    expect(redirect).toContain(
      "return 301 https://new.example.com$request_uri;",
    );
  });
});

describe("apache", () => {
  it("renders a proxy and lists the modules it needs", () => {
    const out = renderSite(
      server("apache"),
      "app",
      spec("apache", {
        type: "proxy",
        upstream: "http://127.0.0.1:3000",
        https: true,
        httpsPort: 8443,
        certPath: "/etc/ssl/a.pem",
        keyPath: "/etc/ssl/a.key",
      }),
    );
    expect(out.content).toContain("<VirtualHost *:80>");
    expect(out.content).toContain("<VirtualHost *:8443>");
    expect(out.content).toContain("ServerAlias www.example.com");
    expect(out.content).toContain(
      "ProxyPass / http://127.0.0.1:3000/ upgrade=websocket",
    );
    expect(out.content).toContain(
      "Redirect permanent / https://example.com:8443/",
    );
    expect(out.content).toContain("ErrorLog /var/log/apache2/app.error.log");
    expect(out.modules).toEqual(
      expect.arrayContaining(["proxy", "proxy_http", "ssl", "headers"]),
    );
    expect(out.ports).toEqual([80, 8443]);
  });

  it("uses httpd log paths on RHEL", () => {
    const out = renderSite(server("apache", "confd"), "x", spec("apache"));
    expect(out.content).toContain("ErrorLog /var/log/httpd/x.error.log");
    expect(out.content).toContain("<Directory /var/www/example>");
  });
});

describe("caddy", () => {
  it("renders automatic HTTPS and plain HTTP", () => {
    const tls = renderSite(
      server("caddy"),
      "a",
      spec("caddy", { https: true }),
    ).content;
    expect(tls).toMatch(/^example\.com, www\.example\.com \{/m);
    expect(tls).toContain("root * /var/www/example");
    expect(tls).toContain("encode zstd gzip");
    const plain = renderSite(
      server("caddy"),
      "a",
      spec("caddy", { port: 8080 }),
    ).content;
    expect(plain).toContain(
      "http://example.com:8080, http://www.example.com:8080 {",
    );
  });

  it("proxies by address only", () => {
    const out = renderSite(
      server("caddy"),
      "a",
      spec("caddy", { type: "proxy", upstream: "http://127.0.0.1:3000" }),
    ).content;
    expect(out).toContain("reverse_proxy 127.0.0.1:3000");
    expect(() =>
      renderSite(
        server("caddy"),
        "a",
        spec("caddy", { type: "proxy", upstream: "http://127.0.0.1:3000/app" }),
      ),
    ).toThrow(/path/);
  });
});

describe("form values in the file", () => {
  it("reads back what it wrote", () => {
    const s = spec("nginx", { spa: true });
    const out = renderSite(server("nginx"), "example", s).content;
    expect(readSpec(out)).toEqual(s);
    expect(readSpec("server {}")).toBeNull();
  });

  it("drops them from hand written text", () => {
    const out = renderSite(server("nginx"), "e", spec("nginx")).content;
    const dropped = dropSpec(out);
    expect(readSpec(dropped)).toBeNull();
    expect(dropped.startsWith("server {")).toBe(true);
    expect(dropSpec("server {}\n")).toBe("server {}\n");
  });
});
