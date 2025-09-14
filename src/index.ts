// src/index.ts
import "dotenv/config";
import type { RequestInit, Response } from "node-fetch"; // types only for fallback import
import { AppServer, AppSession, ViewType, BitmapUtils } from "@mentra/sdk";

/**
 * Simple single-file MentraOS proof-of-concept Nav app.
 *
 * - Uses AppServer(config) per SDK (pass PACKAGE_NAME + MENTRAOS_API_KEY in .env).
 * - Implements protected onSession(session, sessionId, userId) and onStop.
 * - Uses global fetch when available (Node >= 18). Falls back to node-fetch via dynamic import if necessary.
 * - Calls BitmapUtils.loadBmpFrames(folder, <number>) (second arg required by SDK examples).
 *
 * Environment variables required:
 *   PACKAGE_NAME     (e.g. "com.yourname.mentranav")
 *   MENTRAOS_API_KEY
 *   PORT (optional, defaults to 3000)
 *   MOCK_API_URL (the mocky.dev url)
 */

// ---------- small helpers ----------
function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

// safeFetch: uses global fetch (Node 18+) or falls back to node-fetch via dynamic import.
// This avoids hard `import 'node-fetch'` which causes "cannot be found" if it's not installed.
async function safeFetch(input: string, init?: RequestInit): Promise<Response> {
  if (typeof (globalThis as any).fetch === "function") {
    return (globalThis as any).fetch(input, init);
  }
  // dynamic import only if needed (keeps dev environments that don't have node-fetch from failing at import time)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { default: nodeFetch } = await import("node-fetch");
  return nodeFetch(input as any, init as any) as unknown as Response;
}

// ---------- types ----------
type NextAction =
  | "turn-left"
  | "turn-right"
  | "u-turn"
  | "straight"
  | "arrived";
interface NavStatus {
  danger: boolean;
  distanceToLocationMeters: number;
  distanceToNextActionMeters: number;
  nextAction: NextAction;
  etaSeconds: number;
  speedKph: number;
}

// ---------- App (single-file) ----------
export class SimpleNavApp extends AppServer {
  private mockApiUrl: string;
  // store a stopper per live sessionId so onStop can cancel polling
  private sessionStopper = new Map<string, () => void>();

  constructor() {
    // read required fields from env, validate, then pass to super(config)
    const packageName = process.env.PACKAGE_NAME;
    const apiKey = process.env.MENTRAOS_API_KEY;
    const port = process.env.PORT ? Number(process.env.PORT) : 3000;

    if (!packageName || !apiKey) {
      throw new Error(
        "PACKAGE_NAME and MENTRAOS_API_KEY must be set in environment",
      );
    }

    // AppServer requires a config object in constructor (packageName, apiKey, etc.)
    super({ packageName, apiKey, port });

    this.mockApiUrl =
      "https://apifastmock.com/mock/QpEri-21HCDVZoku8oMuKDYqlScELI8DxCFySVVpuZbkDxmsMKYO1j7OON0YQi4JOnmz4s85cKyNf46pgfp8_l8Bf1AOtRdedSzE9-hnr6AomfWjNPRjAfVOIPGlRacz8zezJ9Qwjx_mgeoFYLrX-n26-wd9pykuoIhYz1KkXq-LBupTbKWBq3yUmcbJYMweQXyDhVLbApD4JJAZZ7MnYI7Naz7nLSg_wj17E1dn";
    //process.env.MOCK_API_URL ||
    //"https://apifastmock.com/mock/bRkzSdU1qw-0UKxykJMkmN9haPUV0ZjkhB7ei61gV3qZNPylYkISnJbJfOH8H56X48mh2-V_1JGEJlLZRbrBa1z145ydRqivvpgoskrB9BY006stmj2EQKnfvDfg_j8y0RxK1eFRveGxrf41bASHp50-YckaHBYt615QynjtWPSyVwmn6muZgt5KXSSYzkLSc3HIVKW2-WbTH0-gm67X36pGU-Yl3PnDawLKccvIoZ8H8QhJlB2J6HBHkLRARJA";
  }

  // NOTE: override onSession(session, sessionId, userId) signature per SDK docs
  protected async onSession(
    session: AppSession,
    sessionId: string,
    userId: string,
  ): Promise<void> {
    console.log("onSession started:", sessionId, userId);

    // quick welcome animation (typewriter + flicker)
    await this.animateHackerText(session, "MentraNav — Commute Mode");

    // start polling nav API
    let stopped = false;
    this.sessionStopper.set(sessionId, () => {
      stopped = true;
    });

    const pollIntervalMs = 2000;
    (async () => {
      while (!stopped) {
        try {
          const nav = await this.fetchNavStatus();
          this.updateUI(session, nav);
        } catch (err) {
          console.warn(`[${sessionId}] fetchNavStatus error:`, err);
          // show a brief error card (non-blocking)
          session.layouts.showReferenceCard(
            "Network error",
            "Unable to fetch nav data",
            {
              view: ViewType.MAIN,
              durationMs: 2500,
            },
          );
        }
        // wait (check stopped on next loop)
        await sleep(pollIntervalMs);
      }
      console.log(`[${sessionId}] polling stopped`);
    })();
  }

  // called when MentraOS cloud tells us the session is ending
  protected async onStop(
    sessionId: string,
    userId: string,
    reason: string,
  ): Promise<void> {
    console.log("onStop:", sessionId, userId, reason);
    const stopper = this.sessionStopper.get(sessionId);
    if (stopper) {
      stopper();
      this.sessionStopper.delete(sessionId);
    }
  }

  // ----- networking -----
  private async fetchNavStatus(): Promise<NavStatus> {
    const resp = await safeFetch(this.mockApiUrl);
    if (!resp.ok) throw new Error(`Nav API HTTP ${resp.status}`);
    const json = (await resp.json()) as NavStatus;
    // basic validation (defensive)
    if (
      typeof json.distanceToLocationMeters !== "number" ||
      typeof json.speedKph !== "number"
    ) {
      throw new Error("Invalid NavStatus payload");
    }
    return json;
  }

  // ----- UI update logic -----
  private updateUI(session: AppSession, nav: NavStatus) {
    // dashboard persistent cards
    session.layouts.showDashboardCard(
      "Speed",
      `${nav.speedKph.toFixed(0)} kph`,
      { view: ViewType.DASHBOARD },
    );
    session.layouts.showDashboardCard(
      "ETA",
      `${Math.round(nav.etaSeconds / 60)} min`,
      { view: ViewType.DASHBOARD },
    );

    // danger alert
    if (nav.danger) {
      session.layouts.showReferenceCard(
        "Danger",
        "Entering dangerous zone — proceed with caution",
        {
          view: ViewType.MAIN,
          durationMs: 4000,
        },
      );
    }

    // next action text
    const nextText =
      nav.nextAction === "arrived"
        ? "Arrived"
        : `${nav.nextAction} in ${Math.round(nav.distanceToNextActionMeters)} m`;
    session.layouts.showDoubleTextWall("Next", nextText, {
      view: ViewType.MAIN,
      durationMs: 3000,
    });

    // arrived
    if (nav.distanceToLocationMeters < 10) {
      session.layouts.showReferenceCard(
        "Arrived",
        "You have reached your destination",
        {
          view: ViewType.MAIN,
          durationMs: 5000,
        },
      );
    }
  }

  // ----- small "hacker" animation (typewriter + flicker) -----
  private async animateHackerText(
    session: AppSession,
    text: string,
  ): Promise<void> {
    // typewriter
    let out = "";
    for (let i = 0; i < text.length; i++) {
      out += text[i];
      session.layouts.showTextWall(out, { view: ViewType.MAIN });
      await sleep(40);
    }

    // flicker
    const charset = "abcdefghijklmnopqrstuvwxyz0123456789<>/\\|{}[]()!@#$%^&*";
    const flickerFor = 1200;
    const start = Date.now();
    while (Date.now() - start < flickerFor) {
      const s = text
        .split("")
        .map((ch) =>
          Math.random() < 0.18
            ? charset[Math.floor(Math.random() * charset.length)]
            : ch,
        )
        .join("");
      session.layouts.showTextWall(s, { view: ViewType.MAIN });
      await sleep(80);
    }

    // final stable
    session.layouts.showTextWall(text, {
      view: ViewType.MAIN,
      durationMs: 1200,
    });
  }

  // ----- optional GIF-like animation using BMP frames on disk -----
  // This uses the SDK's BitmapUtils.loadBmpFrames(folder, <something>) example form.
  // The SDK docs show a second arg — pass a conservative 'maxFrames' like 20.
  //public async playBmpAnimationIfAvailable(
  //  session: AppSession,
  //  framesFolder: string,
  //) {
  //  try {
  //    // call with 2nd argument per docs/examples (max frames or sampling param)
  //    const frames = await BitmapUtils.loadBmpFrames(framesFolder, 20);
  //    const controller = session.layouts.showBitmapAnimation(
  //      frames,
  //      150,
  //      true,
  //      { view: ViewType.MAIN },
  //    );
  //    // play for N seconds then stop (example)
  //    await sleep(4000);
  //    controller.stop();
  //  } catch (err) {
  //    console.warn("playBmpAnimationIfAvailable error:", err);
  //  }
  //}
}

// ---------- bootstrap ----------
async function main() {
  const app = new SimpleNavApp();
  await app.start();
  console.log("SimpleNavApp started.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
