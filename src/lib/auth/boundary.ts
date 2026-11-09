// Isolated boundary: callers supply the existing throttle, credential and session
// primitives. Rotate the session signing key whenever credentials change; this
// invalidates all sessions. Do not expose endpoints until the storage and caller
// authorization guarantees have been independently verified.
type Dependencies = {
  origin: string;
  consumeAttempt: () => Promise<boolean>;
  verifyCredentials: (username: unknown, password: unknown) => Promise<boolean>;
  createSession: () => Promise<string>;
  verifySession: (token: string) => Promise<boolean>;
};

const cookieName = '__Host-admin';
const tokenPattern = /^[A-Za-z0-9._-]{1,4096}$/;

function validOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && url.origin === origin && !url.username && !url.password;
  } catch { return false; }
}

function bounded(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && Buffer.byteLength(value, 'utf8') <= max;
}

export function createAuthBoundary(deps: Dependencies) {
  const configured = validOrigin(deps.origin);
  async function authorizeRead(cookie: unknown): Promise<boolean> {
    try {
      if (!configured || typeof cookie !== 'string' || cookie.length > 8192) return false;
      const matches = cookie.split(';').map(part => part.trim()).filter(part => part.startsWith(`${cookieName}=`));
      if (matches.length !== 1) return false;
      const token = matches[0].slice(cookieName.length + 1);
      return tokenPattern.test(token) && await deps.verifySession(token) === true;
    } catch { return false; }
  }
  return {
    authorizeRead,
    async login(username: unknown, password: unknown, origin: unknown): Promise<string | null> {
      try {
        if (!configured || origin !== deps.origin || await deps.consumeAttempt() !== true) return null;
        if (!bounded(username, 128) || !bounded(password, 1024)) return null;
        if (await deps.verifyCredentials(username, password) !== true) return null;
        const token = await deps.createSession();
        if (typeof token !== 'string' || !tokenPattern.test(token)) return null;
        return `${cookieName}=${token}; Path=/; Max-Age=28800; Secure; HttpOnly; SameSite=Strict`;
      } catch { return null; }
    },
    logout(origin: unknown): string | null {
      if (!configured || origin !== deps.origin) return null;
      return `${cookieName}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict`;
    },
    async authorize(cookie: unknown, origin: unknown): Promise<boolean> {
      return origin === deps.origin && await authorizeRead(cookie);
    },
  };
}
