export {
  ApiClient,
  parse_args,
};

// Match curl -k for the local self-signed cert. Must run before any fetch call
// so undici picks it up when the global dispatcher is created.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

interface CommonArgs {
  base_url: string;
  username: string;
  password: string;
}

function parse_args(positional: string[]): CommonArgs {
  return {
    base_url: positional[0] ?? "https://localhost",
    username: process.env.USERNAME ?? "testuser",
    password: process.env.PASSWORD ?? "irrelevant",
  };
}

class ApiClient {
  private readonly base_url: string;
  private readonly cookies = new Map<string, string>();

  constructor(base_url: string) {
    this.base_url = base_url.replace(/\/$/, "");
  }

  async login(username: string, password: string): Promise<void> {
    const url = `${this.base_url}/api/login`;
    console.log(`==> POST ${url}  (user: ${username})`);
    const res = await this.request("POST", "/api/login", {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (res.status !== 200) {
      throw new Error(`Login failed (HTTP ${res.status})`);
    }
  }

  async request(
    method: string,
    path: string,
    init: { headers?: Record<string, string>; body?: BodyInit } = {},
  ): Promise<{ status: number; body: string }> {
    const url = `${this.base_url}${path}`;
    const headers = new Headers(init.headers);
    const cookie_header = this.cookie_header();
    if (cookie_header) headers.set("Cookie", cookie_header);

    const res = await fetch(url, { method, headers, body: init.body });
    this.absorb_cookies(res);

    const body = await res.text();
    console.log(`    HTTP ${res.status}`);
    if (body) console.log(body);
    return { status: res.status, body };
  }

  private cookie_header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  private absorb_cookies(res: Response): void {
    // Node's Headers exposes Set-Cookie via getSetCookie(); avoids the
    // multi-value flattening that .get("set-cookie") would do.
    const set_cookies = res.headers.getSetCookie();
    for (const sc of set_cookies) {
      const first = sc.split(";", 1)[0];
      if (!first) continue;
      const eq = first.indexOf("=");
      if (eq <= 0) continue;
      this.cookies.set(first.slice(0, eq).trim(), first.slice(eq + 1).trim());
    }
  }
}
