import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { STATUS, LIST } from "./fixtures";
import { startServer, type TestServer } from "./helpers";

let s: TestServer | null = null;

afterEach(async () => {
  await s?.close();
  s = null;
});

async function server(options: Parameters<typeof startServer>[0] = {}) {
  const srv = await startServer(options);
  srv.ssh.replies.push({ match: 'echo "manager=$pm"', stdout: STATUS });
  srv.ssh.replies.push({ match: "certs=$(mktemp)", stdout: LIST });
  return srv;
}

const decoded = (stdin: string) =>
  [...stdin.matchAll(/printf '%s' '([A-Za-z0-9+/=]+)' \| base64 -d/g)]
    .map((m) => Buffer.from(m[1], "base64").toString("utf8"))
    .join("\n");

const newSite = {
  server: "nginx",
  name: "shop",
  spec: {
    type: "proxy",
    names: ["shop.example.com"],
    upstream: "http://127.0.0.1:8080",
  },
};

describe("reads", () => {
  it("reports status with the caller's rights", async () => {
    s = await server();
    const res = await s.request("GET", "/1/status");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      canEdit: true,
      readOnly: false,
      watching: false,
      certbot: "4.0.0",
    });
    expect(res.body.servers).toHaveLength(3);
  });

  it("lists sites", async () => {
    s = await server();
    const res = await s.request("GET", "/1/sites");
    expect(res.body.map((x: { key: string }) => x.key)).toContain(
      "nginx:default",
    );
  });

  it("previews a site without touching the host as root", async () => {
    s = await server();
    const res = await s.request("POST", "/1/sites/preview", newSite);
    expect(res.status).toBe(200);
    expect(res.body.content).toContain("proxy_pass http://127.0.0.1:8080;");
    expect(s.ssh.calls.every((c) => !c.stdin.includes("CLEAN="))).toBe(true);
  });

  it("refuses when the plugin is off for the host", async () => {
    s = await server({ settings: { enableWebServers: false } });
    const res = await s.request("GET", "/1/status");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("disabled");
  });

  it("keeps logs and files inside their folders", async () => {
    s = await server();
    const log = await s.request("GET", "/1/log?kind=file&path=/etc/shadow");
    expect(log.status).toBe(400);
    const file = await s.request(
      "GET",
      "/1/file?server=nginx&path=/etc/passwd",
    );
    expect(file.status).toBe(400);
    const sneaky = await s.request(
      "GET",
      "/1/file?server=nginx&path=/etc/nginx/../shadow",
    );
    expect(sneaky.status).toBe(400);
  });

  it("reads a log with counts", async () => {
    s = await server();
    s.ssh.replies.unshift({
      match: "tail -n 100",
      stdout:
        '1.1.1.1 - - [05/Nov/2026:10:00:00 +0000] "GET / HTTP/1.1" 200 1 "-" "x"\n',
    });
    const res = await s.request(
      "GET",
      "/1/log?kind=file&path=/var/log/nginx/access.log&lines=100",
    );
    expect(res.body.lines).toHaveLength(1);
    expect(res.body.stats.status["2xx"]).toBe(1);
  });
});

describe("changes", () => {
  it("adds a site, tested before the reload", async () => {
    s = await server();
    const res = await s.request("POST", "/1/sites", newSite);
    expect(res.status).toBe(200);
    const script = s.ssh.calls.at(-1)!.stdin;
    expect(script).toContain("nginx -t");
    expect(script).toContain("F='/etc/nginx/sites-available/shop.conf'");
    expect(script).toContain('ln -sfn "$F" "$L"');
    expect(script.indexOf("nginx -t")).toBeLessThan(
      script.indexOf("systemctl reload nginx"),
    );
    expect(decoded(script)).toContain("server_name shop.example.com;");
    expect(s.mock.audits.at(-1)).toMatchObject({
      action: "web-servers.site.create",
      success: true,
    });
  });

  it("shows why a broken config was put back", async () => {
    s = await server();
    s.ssh.replies.unshift({
      match: "CLEAN=$(mktemp -d)",
      stdout: 'SCRIPT_ERR:nginx: [emerg] unknown directive "oops"\n',
      code: 3,
    });
    const res = await s.request("PUT", "/1/sites/nginx/default", {
      content: "oops;",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("unknown directive");
    expect(res.body.output).toContain("unknown directive");
  });

  it("needs edit access and respects read only", async () => {
    s = await server({ level: "connect" });
    const denied = await s.request("POST", "/1/sites", newSite);
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("HOST_EDIT_REQUIRED");
    await s.close();
    s = await server({ settings: { readOnly: true } });
    const ro = await s.request("POST", "/1/sites/nginx/default/disable");
    expect(ro.status).toBe(403);
    expect(ro.body.code).toBe("readOnly");
  });

  it("refuses servers that are not installed", async () => {
    s = await server();
    s.ssh.replies.unshift({
      match: 'echo "manager=$pm"',
      stdout: "manager=apt-get\nnginx=1.26.3\nnginxlayout=debian\n",
    });
    const res = await s.request("POST", "/1/service", {
      server: "caddy",
      action: "reload",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Caddy is not installed");
  });

  it("tests the config before a reload", async () => {
    s = await server();
    await s.request("POST", "/1/service", {
      server: "apache",
      action: "reload",
    });
    const script = s.ssh.calls.at(-1)!.stdin;
    expect(script).toContain("apache2ctl -t");
    expect(script).toContain("systemctl reload apache2");
  });

  it("issues a certificate and switches a form site to HTTPS", async () => {
    s = await server();
    const form = await s.request("POST", "/1/sites/preview", newSite);
    s.ssh.replies.unshift({
      match: "@@WS@@FILE nginx|$EN|$F",
      stdout: `@@WS@@FILE nginx|1|/etc/nginx/sites-available/shop.conf\n${form.body.content}`,
    });
    const res = await s.request("POST", "/1/sites/nginx/shop/certificate", {
      email: "me@example.com",
    });
    expect(res.status).toBe(200);
    const certbot = s.ssh.calls.find((c) => c.stdin.includes("certonly"))!;
    expect(certbot.stdin).toContain("--nginx --cert-name 'shop.example.com'");
    expect(certbot.stdin).toContain("--email 'me@example.com'");
    const saved = decoded(s.ssh.calls.at(-1)!.stdin);
    expect(saved).toContain(
      "ssl_certificate /etc/letsencrypt/live/shop.example.com/fullchain.pem;",
    );
  });

  it("refuses certbot for Caddy", async () => {
    s = await server();
    const res = await s.request("POST", "/1/sites/caddy/files/certificate");
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("on its own");
  });
});

describe("scripts", () => {
  const bash = spawnSync("bash", ["-c", "true"]).status === 0;

  it.skipIf(!bash)("every script parses as bash", async () => {
    s = await server();
    const reads = [
      "status",
      "sites",
      "files?server=nginx",
      "file?server=apache&path=/etc/apache2/apache2.conf",
      "logs",
      "log?kind=file&path=/var/log/nginx/access.log",
      "log?kind=journal&server=caddy",
      "sites/nginx/default",
    ];
    for (const path of reads) await s.request("GET", `/1/${path}`);
    await s.request("POST", "/1/test", { server: "caddy" });
    for (const target of [
      newSite,
      { ...newSite, server: "apache", spec: { ...newSite.spec, port: 8080 } },
      { ...newSite, server: "caddy" },
    ]) {
      await s.request("POST", "/1/sites", target);
    }
    await s.request("PUT", "/1/sites/nginx/default", { content: "x" });
    for (const verb of ["enable", "disable"]) {
      await s.request("POST", `/1/sites/apache/blog/${verb}`);
      await s.request("POST", `/1/sites/caddy/files/${verb}`);
    }
    await s.request("DELETE", "/1/sites/nginx/app");
    await s.request("PUT", "/1/file", {
      server: "nginx",
      path: "/etc/nginx/nginx.conf",
      content: "events {}",
    });
    await s.request("PUT", "/1/file", {
      server: "nginx",
      path: "/etc/nginx/nginx.conf",
      backup: "1762336800",
    });
    for (const action of ["start", "stop", "enable"]) {
      await s.request("POST", "/1/service", { server: "nginx", action });
    }
    await s.request("POST", "/1/install", { server: "caddy" });
    await s.request("POST", "/1/install-certbot");
    expect(s.ssh.calls.length).toBeGreaterThan(20);
    for (const { stdin } of s.ssh.calls) {
      const out = spawnSync("bash", ["-n"], { input: stdin });
      expect(out.status, `${stdin}\n${out.stderr}`).toBe(0);
    }
  });
});
