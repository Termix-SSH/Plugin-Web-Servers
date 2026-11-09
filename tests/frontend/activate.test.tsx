import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import {
  renderWithApp,
  type RenderedPluginApp,
} from "@termix-ssh/plugin-sdk/testing";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import * as plugin from "../../src/frontend/index";
import manifestJson from "../../manifest.json";
import locales from "../../locales/en.json";

const manifest = manifestJson as unknown as PluginManifest;

let rendered: RenderedPluginApp | null = null;

afterEach(async () => {
  await rendered?.deactivate();
  rendered = null;
});

const server = (kind: string, over: Record<string, unknown> = {}) => ({
  kind,
  installed: true,
  version: "1.26.3",
  unit: kind,
  state: "active",
  boot: true,
  layout: "debian",
  root: `/etc/${kind}`,
  mainFile: `/etc/${kind}/${kind}.conf`,
  siteDir: `/etc/${kind}/sites-available`,
  enabledDir: `/etc/${kind}/sites-enabled`,
  logDir: `/var/log/${kind}`,
  ...over,
});

const status = {
  os: "Debian GNU/Linux 13",
  root: true,
  systemd: true,
  manager: "apt-get",
  certbot: "4.0.0",
  certbotNginx: true,
  certbotApache: false,
  servers: [
    server("nginx"),
    server("apache", { installed: false, version: "", state: "" }),
    server("caddy", { installed: false, version: "", state: "" }),
  ],
  phpSockets: [],
  watching: false,
  canEdit: true,
  readOnly: false,
};

const sites = [
  {
    key: "nginx:shop",
    server: "nginx",
    name: "shop",
    file: "/etc/nginx/sites-available/shop.conf",
    enabled: true,
    names: ["shop.example.com"],
    listen: ["443 ssl"],
    root: "",
    upstream: "http://127.0.0.1:8080",
    tls: true,
    certPath: "/etc/letsencrypt/live/shop.example.com/fullchain.pem",
    certExpiry: "2026-12-01T10:00:00.000Z",
    certDaysLeft: 3,
    accessLog: "",
    errorLog: "",
    spec: null,
  },
];

function api(current: unknown) {
  return {
    get: vi.fn(async (url: string) => ({
      data: url.endsWith("/status")
        ? current
        : url.endsWith("/sites")
          ? sites
          : url.includes("/sites/nginx/shop")
            ? {
                file: sites[0].file,
                enabled: true,
                content: "server { listen 80; }\n",
                spec: null,
              }
            : [],
    })),
    post: vi.fn(async () => ({ data: { ok: true, output: "" } })),
    put: vi.fn(async () => ({ data: { ok: true, output: "" } })),
    delete: vi.fn(async () => ({ data: { ok: true, output: "" } })),
  } as never;
}

const host = { id: 1, name: "web", enableSsh: true };

describe(`${manifest.id} activate`, () => {
  it("registers the host tab, card and panel", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    expect(rendered.registered.tabs()).toEqual(["web-servers"]);
  });

  it("lists sites with their certificate days", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api(status),
    });
    rendered.renderTab("web-servers", { isVisible: true, host });
    expect(await screen.findByText("shop")).toBeTruthy();
    expect(screen.getByText("3 days left")).toBeTruthy();
    expect(screen.getByText(locales.sites.disable)).toBeTruthy();
  });

  it("opens a hand written site as text", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api(status),
    });
    rendered.renderTab("web-servers", { isVisible: true, host });
    fireEvent.click(await screen.findByText("shop"));
    expect(await screen.findByDisplayValue(/listen 80/)).toBeTruthy();
    expect(screen.queryByText(locales.site.modeForm)).toBeNull();
    expect(screen.getByText(locales.tls.issue)).toBeTruthy();
  });

  it("offers the site form for a new site", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api(status),
    });
    rendered.renderTab("web-servers", { isVisible: true, host });
    fireEvent.click(await screen.findByText(locales.sites.add));
    expect(await screen.findByText(locales.site.domains)).toBeTruthy();
    expect(screen.getByText(locales.site.modeText)).toBeTruthy();
  });

  it("registers the dashboard card, panel action and Host Metrics card", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    expect(rendered.registered.dashboardCards()).toEqual(["web-servers-hosts"]);
    expect(rendered.registered.actions()).toContain("web-servers.togglePanel");
    expect(rendered.registered.slot("host-metrics.managers")).toEqual([
      "webserver_manager",
    ]);
  });

  it("shows each host's servers on the dashboard card", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      permissions: ["web-servers.use"],
      hosts: [{ id: "1", name: "web", ip: "10.0.0.1", port: 22 }],
      api: {
        get: vi.fn(async () => ({
          data: [
            {
              hostId: 1,
              checkedAt: new Date().toISOString(),
              servers: [
                { kind: "nginx", version: "1.26.3", state: "active", sites: 2 },
                { kind: "caddy", version: "2.6.2", state: "failed", sites: 1 },
              ],
            },
          ],
        })),
      } as never,
    });
    rendered.renderDashboardCard("web-servers-hosts");
    expect(await screen.findByText("web")).toBeTruthy();
    expect(screen.getByText("3 sites")).toBeTruthy();
    expect(screen.getByText("Caddy")).toBeTruthy();
  });

  it("offers to install a server when none is there", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api({
        ...status,
        servers: status.servers.map((s) => ({ ...s, installed: false })),
      }),
    });
    rendered.renderTab("web-servers", { isVisible: true, host });
    fireEvent.click(await screen.findByText(locales.tab.viewServer));
    expect((await screen.findAllByText(locales.server.install)).length).toBe(3);
  });
});

describe("homepage widget", () => {
  it("adds a homepage widget and declares the extension point", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    expect(rendered.registered.extensions("homepage.widgets")).toEqual([
      "web_servers_widget",
    ]);
    expect(manifest.contributes.uses).toContain("homepage.widgets");
  });
});
