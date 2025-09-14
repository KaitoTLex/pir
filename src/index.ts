import "dotenv/config";
import type { RequestInit, Response } from "node-fetch";
import {
  AppServer,
  AppSession,
  ViewType,
  BitmapUtils,
  LayoutType,
} from "@mentra/sdk";

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

export class SimpleNavApp extends AppServer {
  private mockApiUrl: string;
  private sessionStopper = new Map<string, () => void>();

  // 🟢 Centralized settings
  private mentraosSettings = {
    CONNECTION_ACK: true, // ✅ Required by MentraOS
    defaultView: ViewType.MAIN,
    defaultLayout: LayoutType.TEXT_WALL,
    updateIntervalMs: 2000,
    animation: {
      hackerTextSpeedMs: 50,
      flickerDurationMs: 1200,
      flickerCharset:
        "abcdefghijklmnopqrstuvwxyz0123456789<>/\\|{}[]()!@#$%^&*",
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
      "https://mocky.io/v2/65d66e9a3000006e0f5f1234"; // replace with your mocky URL
  }

  protected async onSession(
    session: AppSession,
    sessionId: string,
    userId: string,
  ): Promise<void> {
    console.log("onSession started:", sessionId, userId);
    await this.animateHackerText(session, "MentraNav — Commute Mode");

    let stopped = false;
    this.sessionStopper.set(sessionId, () => {
      stopped = true;
    });

    (async () => {
      while (!stopped) {
        try {
          const nav = await this.fetchNavStatus();
          this.updateUI(session, nav);
        } catch (err) {
          console.warn(`[${sessionId}] fetchNavStatus error:`, err);
          session.layouts.showReferenceCard(
            "Network error",
            "Unable to fetch nav data",
            {
              view: this.mentraosSettings.defaultView,
              durationMs: 2500,
            },
          );
        }
        await sleep(this.mentraosSettings.updateIntervalMs);
      }
      console.log(`[${sessionId}] polling stopped`);
    })();
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

  private async fetchNavStatus(): Promise<NavStatus> {
    const resp = await safeFetch(this.mockApiUrl);
    if (!resp.ok) throw new Error(`Nav API HTTP ${resp.status}`);
    return (await resp.json()) as NavStatus;
  }

  private updateUI(session: AppSession, nav: NavStatus) {
    // Speed + ETA
    session.layouts.showDashboardCard(
      "SPEED",
      `${nav.speedKph.toFixed(0)} ${this.mentraosSettings.dashboard.speedUnit}`,
      {
        view: ViewType.DASHBOARD,
      },
    );
    session.layouts.showDashboardCard(
      "ETA",
      `${Math.round(nav.etaSeconds / 60)} ${this.mentraosSettings.dashboard.etaUnit}`,
      {
        view: ViewType.DASHBOARD,
      },
    );

    // Danger alert
    if (nav.danger) {
      session.layouts.showReferenceCard("DANGER", "Entering dangerous zone", {
        view: this.mentraosSettings.defaultView,
        durationMs: 4000,
      });
    }

    // Next action
    const nextText =
      nav.nextAction === "arrived"
        ? "Arrived"
        : `${nav.nextAction} in ${Math.round(nav.distanceToNextActionMeters)} ${this.mentraosSettings.dashboard.distanceUnit}`;
    session.layouts.showDoubleTextWall("Next", nextText, {
      view: this.mentraosSettings.defaultView,
      durationMs: 3000,
    });

    // Destination arrival
    if (nav.distanceToLocationMeters < 10) {
      session.layouts.showReferenceCard(
        "ARRIVED",
        "You have reached your destination",
        {
          view: this.mentraosSettings.defaultView,
          durationMs: 5000,
        },
      );
    }
  }

  private async animateHackerText(
    session: AppSession,
    text: string,
  ): Promise<void> {
    // typewriter
    let out = "";
    for (let i = 0; i < text.length; i++) {
      out += text[i];
      session.layouts.showTextWall(out, {
        view: this.mentraosSettings.defaultView,
      });
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
          Math.random() < 0.18
            ? this.mentraosSettings.animation.flickerCharset[
                Math.floor(
                  Math.random() *
                    this.mentraosSettings.animation.flickerCharset.length,
                )
              ]
            : ch,
        )
        .join("");
      session.layouts.showTextWall(s, {
        view: this.mentraosSettings.defaultView,
      });
      await sleep(80);
    }

    session.layouts.showTextWall(text, {
      view: this.mentraosSettings.defaultView,
      durationMs: 1200,
    });
  }
}

async function main() {
  const app = new SimpleNavApp();
  await app.start();
  console.log("SimpleNavApp started.");
}
main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
