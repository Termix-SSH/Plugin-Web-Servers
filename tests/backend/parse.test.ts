import { describe, expect, it } from "vitest";
import {
  logStats,
  parseFileContent,
  parseSites,
  parseStatus,
} from "../../src/backend/parse.js";
import { ACCESS_LOG, LIST, STATUS } from "./fixtures";

describe("status", () => {
  it("reads every server and certbot", () => {
    const status = parseStatus(STATUS);
    expect(status.manager).toBe("apt-get");
    expect(status.certbot).toBe("4.0.0");
    expect(status.certbotNginx).toBe(true);
    expect(status.certbotApache).toBe(false);
    expect(status.phpSockets).toEqual(["/run/php/php8.4-fpm.sock"]);
    const [nginx, apache, caddy] = status.servers;
    expect(nginx).toMatchObject({
      kind: "nginx",
      installed: true,
      version: "1.26.3",
      state: "active",
      boot: true,
      siteDir: "/etc/nginx/sites-available",
      enabledDir: "/etc/nginx/sites-enabled",
    });
    expect(apache).toMatchObject({
      unit: "apache2",
      state: "inactive",
      boot: false,
      root: "/etc/apache2",
    });
    expect(caddy).toMatchObject({ siteDir: "/etc/caddy/sites", boot: true });
  });

  it("knows the RHEL layout and missing servers", () => {
    const status = parseStatus(
      "nginx=1.20.1\nnginxlayout=confd\napache=2.4.57\napachelayout=confd\n",
    );
    expect(status.servers[0].siteDir).toBe("/etc/nginx/conf.d");
    expect(status.servers[1]).toMatchObject({
      unit: "httpd",
      siteDir: "/etc/httpd/conf.d",
      logDir: "/var/log/httpd",
    });
    expect(status.servers[2].installed).toBe(false);
  });
});

describe("sites", () => {
  const now = Date.parse("2026-11-05T00:00:00Z");
  const sites = parseSites(LIST, now);

  it("reads each server's sites, sorted", () => {
    expect(sites.map((s) => s.key)).toEqual([
      "apache:blog",
      "caddy:files",
      "nginx:app",
      "nginx:default",
    ]);
  });

  it("reads nginx facts and skips comments", () => {
    const def = sites.find((s) => s.key === "nginx:default")!;
    expect(def.names).toEqual(["_"]);
    expect(def.root).toBe("/var/www/html");
    expect(def.enabled).toBe(true);
    const app = sites.find((s) => s.key === "nginx:app")!;
    expect(app.enabled).toBe(false);
    expect(app.names).toEqual(["app.example.com", "www.app.example.com"]);
    expect(app.upstream).toBe("http://127.0.0.1:3000");
    expect(app.tls).toBe(true);
    expect(app.certDaysLeft).toBe(26);
    expect(app.accessLog).toBe("/var/log/nginx/app.access.log");
  });

  it("reads Apache and Caddy facts", () => {
    const blog = sites.find((s) => s.key === "apache:blog")!;
    expect(blog.names).toEqual(["blog.example.com", "www.blog.example.com"]);
    expect(blog.root).toBe("/var/www/blog");
    expect(blog.listen).toEqual(["*:80"]);
    const files = sites.find((s) => s.key === "caddy:files")!;
    expect(files.names).toEqual(["files.example.com", "files.local"]);
    expect(files.tls).toBe(true);
    expect(files.root).toBe("/srv/files");
    expect(files.accessLog).toBe("/var/log/caddy/files.access.log");
  });
});

describe("files", () => {
  it("decodes a file and its backups", () => {
    const text = "server {}\n";
    const out = parseFileContent(
      `@@WS@@PATH /etc/nginx/nginx.conf\n${Buffer.from(text).toString("base64")}\n@@WS@@BACKUP 1762300000|10\n@@WS@@BACKUP 1762336800|12\n`,
    );
    expect(out.path).toBe("/etc/nginx/nginx.conf");
    expect(out.content).toBe(text);
    expect(out.backups.map((b) => b.id)).toEqual(["1762336800", "1762300000"]);
  });
});

describe("log counts", () => {
  it("counts combined and Caddy lines", () => {
    const stats = logStats(ACCESS_LOG)!;
    expect(stats.lines).toBe(6);
    expect(stats.status).toEqual({
      "2xx": 3,
      "3xx": 1,
      "4xx": 1,
      "5xx": 1,
      other: 0,
    });
    expect(stats.paths[0]).toEqual({ value: "/", count: 2 });
    expect(stats.clients[0].count).toBe(2);
  });

  it("is null for error logs", () => {
    expect(logStats(["2026/11/05 [error] nope"])).toBeNull();
  });
});
