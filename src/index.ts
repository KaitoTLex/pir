// src/index.ts
import "dotenv/config";
import type { RequestInit, Response } from "node-fetch";
import {
  AppServer,
  AppSession,
  ViewType,
  BitmapUtils,
  LayoutType,
} from "@mentra/sdk";

// ---------- Helpers ----------
function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

async function safeFetch(input: string, init?: RequestInit): Promise<Response> {
  if (typeof (globalThis as any).fetch === "function") {
    return (globalThis as any).fetch(input, init);
  }
  const { default: nodeFetch } = await import("node-fetch");
  return nodeFetch(input as any, init as any) as unknown as Response;
}

// ---------- Types ----------
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

// ---------- Main App ----------
export class SimpleNavApp extends AppServer {
  private mockApiUrl: string;
  private sessionStopper = new Map<string, () => void>();

  private mentraosSettings = {
    CONNECTION_ACK: true, // required by SDK
    defaultView: ViewType.MAIN,
    defaultLayout: LayoutType.TEXT_WALL,
    updateIntervalMs: 2000,
    animation: {
      hackerTextSpeedMs: 50,
      flickerDurationMs: 1200,
      flickerCharset:
        "abcdefghijklmnopqrstuvwxyz0123456789<>/\\|{}[]()!@#$%^&*",
      alertBounceCount: 3,
    },
    dashboard: {
      speedUnit: "kph",
      etaUnit: "min",
      distanceUnit: "m",
    },
  };

  constructor() {
    const packageName = process.env.PACKAGE_NAME;
    const apiKey = process.env.MENTRAOS_API_KEY;
    const port = process.env.PORT ? Number(process.env.PORT) : 3000;

    if (!packageName || !apiKey) {
      throw new Error(
        "PACKAGE_NAME and MENTRAOS_API_KEY must be set in environment",
      );
    }

    super({ packageName, apiKey, port });

    this.mockApiUrl =
      process.env.MOCK_API_URL ||
      "https://mocky.io/v2/replace_with_your_mockid";
  }

  protected async onSession(
    session: AppSession,
    sessionId: string,
    userId: string,
  ): Promise<void> {
    console.log("onSession started:", sessionId, userId);

    let stopped = false;
    this.sessionStopper.set(sessionId, () => {
      stopped = true;
    });

    // initial welcome
    await this.animateHackerText(session, "MentraNav — Commute Mode");

    // main loop: fetch nav status & cycle UI cards
    while (!stopped) {
      try {
        const nav = await this.fetchNavStatus();
        await this.cycleUI(session, nav);
      } catch (err) {
        console.warn(`[${sessionId}] fetchNavStatus error:`, err);
        await this.animateHackerText(session, "Network error — retrying...");
      }
      await sleep(this.mentraosSettings.updateIntervalMs);
    }

    console.log(`[${sessionId}] polling stopped`);
  }

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

  // ---------- Networking ----------
  private async fetchNavStatus(): Promise<NavStatus> {
    const resp = await safeFetch(this.mockApiUrl);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = (await resp.json()) as NavStatus;
    if (
      typeof json.speedKph !== "number" ||
      typeof json.etaSeconds !== "number" ||
      typeof json.distanceToNextActionMeters !== "number" ||
      typeof json.distanceToLocationMeters !== "number" ||
      typeof json.nextAction !== "string" ||
      typeof json.danger !== "boolean"
    ) {
      throw new Error("Invalid NavStatus payload");
    }
    return json;
  }

  // ---------- UI Cycle ----------
  private async cycleUI(session: AppSession, nav: NavStatus) {
    // 1️⃣ Dashboard metrics
    const dashboardTexts = [
      `Speed: ${nav.speedKph.toFixed(1)} ${this.mentraosSettings.dashboard.speedUnit}`,
      `ETA: ${Math.ceil(nav.etaSeconds / 60)} ${this.mentraosSettings.dashboard.etaUnit}`,
      `Remaining: ${Math.round(nav.distanceToLocationMeters)} ${this.mentraosSettings.dashboard.distanceUnit}`,
    ];

    for (const text of dashboardTexts) {
      await this.animateHackerText(session, text, ViewType.DASHBOARD);
      await sleep(200);
    }

    // 2️⃣ Next action
    const nextText =
      nav.nextAction === "arrived"
        ? "Arrived"
        : `${nav.nextAction.replace("-", " ").toUpperCase()} in ${Math.round(nav.distanceToNextActionMeters)} ${this.mentraosSettings.dashboard.distanceUnit}`;
    await this.animateHackerText(session, `Next: ${nextText}`, ViewType.MAIN);

    // 3️⃣ Danger alert if needed
    if (nav.danger) {
      for (
        let i = 0;
        i < this.mentraosSettings.animation.alertBounceCount;
        i++
      ) {
        await this.animateHackerText(
          session,
          "⚠️ Danger Zone! Proceed with caution",
          ViewType.MAIN,
        );
        await sleep(300);
      }
    }

    // 4️⃣ Arrival
    if (nav.distanceToLocationMeters < 10) {
      await this.animateHackerText(
        session,
        "🎯 Arrived at destination",
        ViewType.MAIN,
      );
    }
  }

  // ---------- Hacker Animation ----------
  private async animateHackerText(
    session: AppSession,
    text: string,
    view?: ViewType,
  ) {
    const actualView = view || this.mentraosSettings.defaultView;

    // typewriter
    let out = "";
    for (let i = 0; i < text.length; i++) {
      out += text[i];
      session.layouts.showTextWall(out, { view: actualView });
      await sleep(this.mentraosSettings.animation.hackerTextSpeedMs);
    }

    // flicker
    const start = Date.now();
    while (
      Date.now() - start <
      this.mentraosSettings.animation.flickerDurationMs
    ) {
      const s = text
        .split("")
        .map((ch) =>
          Math.random() < 0.2
            ? this.mentraosSettings.animation.flickerCharset[
                Math.floor(
                  Math.random() *
                    this.mentraosSettings.animation.flickerCharset.length,
                )
              ]
            : ch,
        )
        .join("");
      session.layouts.showTextWall(s, { view: actualView });
      await sleep(60);
    }

    // final stable
    session.layouts.showTextWall(text, { view: actualView, durationMs: 1200 });
  }
}

// ---------- Bootstrap ----------
async function main() {
  const app = new SimpleNavApp();
  await app.start();
  console.log("SimpleNavApp started");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
