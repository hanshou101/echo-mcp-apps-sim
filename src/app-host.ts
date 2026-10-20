/**
 * MCP Apps host: double-iframe sandbox + AppBridge.
 *
 * Adapted from modelcontextprotocol/ext-apps `examples/basic-host`
 * (`src/implementation.ts`, MIT, https://github.com/modelcontextprotocol/ext-apps).
 * Changes: class wrapper, fixed host implementation info, no theme switching,
 * and a smaller host context sized for the Echo-style screen.
 */
import {
  AppBridge,
  PostMessageTransport,
  RESOURCE_MIME_TYPE,
  buildAllowAttribute,
  type McpUiResourceCsp,
  type McpUiResourcePermissions,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type { CallToolResult, Client, Resource } from "@modelcontextprotocol/client";

const HOST_INFO = { name: "echo-mcp-apps-sim", version: "1.0.0" };
const SANDBOX_READY_TIMEOUT_MS = 8000;
const APP_INIT_TIMEOUT_MS = 12000;

interface UiResourceData {
  html: string;
  csp?: McpUiResourceCsp;
  permissions?: McpUiResourcePermissions;
}

export interface AppHostOptions {
  container: HTMLElement;
  sandboxUrl: string;
  client: Client;
  hostContextSize?: { width: number; height: number };
}

interface MountedApp {
  uri: string;
  iframe: HTMLIFrameElement;
  bridge: AppBridge;
}

export class AppHost {
  private mounted?: MountedApp;
  private resources?: Map<string, Resource>;

  constructor(private readonly options: AppHostOptions) {}

  get currentUri(): string | undefined {
    return this.mounted?.uri;
  }

  /** Show (or refresh) the App for this tool result. */
  async show(
    uri: string,
    args: Record<string, unknown>,
    result: CallToolResult,
  ): Promise<void> {
    if (this.mounted && this.mounted.uri === uri) {
      await this.mounted.bridge.sendToolInput({ arguments: args });
      await this.mounted.bridge.sendToolResult(result);
      return;
    }

    this.teardown();
    const app = await this.readUiResource(uri);

    const iframe = document.createElement("iframe");
    iframe.className = "app-frame";
    iframe.title = "MCP App";
    iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");
    const allowAttribute = buildAllowAttribute(app.permissions);
    if (allowAttribute) iframe.setAttribute("allow", allowAttribute);
    iframe.dataset.appUri = uri;

    const ready = waitForSandboxReady(iframe);
    const url = new URL(this.options.sandboxUrl);
    if (app.csp) url.searchParams.set("csp", JSON.stringify(app.csp));
    iframe.src = url.href;

    this.options.container.replaceChildren(iframe);
    await ready;

    const client = this.options.client;
    const serverCapabilities = client.getServerCapabilities();
    const size = this.options.hostContextSize ?? { width: 864, height: 540 };
    const bridge = new AppBridge(
      client,
      HOST_INFO,
      {
        openLinks: {},
        serverTools: serverCapabilities?.tools ?? {},
        serverResources: serverCapabilities?.resources ?? {},
        updateModelContext: { text: {} },
      },
      {
        hostContext: {
          theme: "dark",
          platform: "web",
          displayMode: "inline",
          availableDisplayModes: ["inline"],
          containerDimensions: { width: size.width, height: size.height },
        },
      },
    );

    let markInitialized: () => void = () => undefined;
    const initialized = new Promise<void>((resolve) => {
      markInitialized = resolve;
    });
    bridge.oninitialized = () => markInitialized();

    bridge.onmessage = async () => ({});
    bridge.onopenlink = async (params) => {
      window.open(params.url, "_blank", "noopener,noreferrer");
      return {};
    };
    bridge.onloggingmessage = (params) => {
      console.info("[MCP App]", params.level, params.data);
    };
    bridge.onsizechange = ({ height }) => {
      if (typeof height === "number" && height > 0) {
        iframe.style.height = `${height}px`;
      }
    };

    await bridge.connect(
      new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!),
    );
    await bridge.sendSandboxResourceReady({
      html: app.html,
      csp: app.csp,
      permissions: app.permissions,
    });

    await withTimeout(
      initialized,
      APP_INIT_TIMEOUT_MS,
      `MCP App did not finish initializing for ${uri}`,
    );

    await bridge.sendToolInput({ arguments: args });
    await bridge.sendToolResult(result);

    this.mounted = { uri, iframe, bridge };
  }

  teardown(): void {
    const mounted = this.mounted;
    this.mounted = undefined;
    if (!mounted) return;
    try {
      void Promise.resolve(mounted.bridge.close()).catch(() => undefined);
    } catch {
      /* already closed */
    }
    mounted.iframe.remove();
  }

  private async readUiResource(uri: string): Promise<UiResourceData> {
    const client = this.options.client;
    const resource = await client.readResource({ uri });
    if (!resource || !Array.isArray(resource.contents) || resource.contents.length !== 1) {
      throw new Error(`Resource ${uri} returned ${resource?.contents?.length ?? 0} contents`);
    }
    const content = resource.contents[0];
    if (content.mimeType !== RESOURCE_MIME_TYPE) {
      throw new Error(`Unsupported MIME type for ${uri}: ${content.mimeType}`);
    }
    const html = "text" in content && typeof content.text === "string"
      ? content.text
      : "blob" in content
        ? atob(content.blob)
        : "";

    const contentMeta = (content as { _meta?: { ui?: { csp?: McpUiResourceCsp; permissions?: McpUiResourcePermissions } } })._meta;
    const listing = await this.listingResource(uri);
    const listingMeta = (listing as { _meta?: { ui?: { csp?: McpUiResourceCsp; permissions?: McpUiResourcePermissions } } })?._meta;
    const uiMeta = contentMeta?.ui ?? listingMeta?.ui;

    return { html, csp: uiMeta?.csp, permissions: uiMeta?.permissions };
  }

  private async listingResource(uri: string): Promise<Resource | undefined> {
    if (!this.resources) {
      try {
        const list = await this.options.client.listResources();
        this.resources = new Map(list.resources.map((r) => [r.uri, r]));
      } catch {
        this.resources = new Map();
      }
    }
    return this.resources.get(uri);
  }
}

function waitForSandboxReady(iframe: HTMLIFrameElement): Promise<void> {
  const method = "ui/notifications/sandbox-proxy-ready";
  return withTimeout(
    new Promise<void>((resolve) => {
      const listener = (event: MessageEvent) => {
        if (event.source === iframe.contentWindow && event.data?.method === method) {
          window.removeEventListener("message", listener);
          resolve();
        }
      };
      window.addEventListener("message", listener);
    }),
    SANDBOX_READY_TIMEOUT_MS,
    "Sandbox proxy did not become ready",
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
