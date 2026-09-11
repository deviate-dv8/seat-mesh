import type {
  AgentProvider,
  ComposerState,
  Detection,
  InjectPlan,
  LimitContext,
  LimitDetector,
  PaneSnapshot,
} from "@seat-mesh/core";
import {
  cmdlines,
  composerFromCapture,
  matchAny,
  modelFromCmdlines,
  scrapePromptTurnGeneric,
} from "./shared.js";

const PATTERNS = [/opencode/];

const ocLimitDetector: LimitDetector = {
  id: "oc-limit",
  match(state: ComposerState) {
    return state.phase === "limit" && state.limitKind === "oc-limit";
  },
  async onRisingEdge(ctx: LimitContext) {
    await ctx.enqueue({
      type: "limits.oc-limit",
      paneId: ctx.pane.paneId,
      payload: { wave: "all-oc-panes" },
    });
  },
};

const ocConnectDetector: LimitDetector = {
  id: "oc-connect",
  match(state: ComposerState) {
    return state.phase === "limit" && state.limitKind === "oc-connect";
  },
  async onRisingEdge(ctx: LimitContext) {
    await ctx.enqueue({
      type: "connectivity.proxy-up",
      paneId: ctx.pane.paneId,
    });
  },
};

export const opencodeProvider: AgentProvider = {
  id: "opencode",

  detect(pane: PaneSnapshot): Detection | null {
    if (!matchAny(cmdlines(pane), PATTERNS)) return null;
    return { providerId: "opencode" };
  },

  composerState(pane: PaneSnapshot) {
    return composerFromCapture(pane, "opencode");
  },

  injectPlan(_pane: PaneSnapshot): InjectPlan {
    return {
      prefix: "",
      useBracketedPaste: false,
      enterDelayMs: 150,
      flushEscFirst: true,
    };
  },

  limits: [ocLimitDetector, ocConnectDetector],

  sessionId() {
    return undefined;
  },

  modelId(pane) {
    return modelFromCmdlines(cmdlines(pane), "opencode");
  },

  scrapePromptTurn(pane) {
    return scrapePromptTurnGeneric(pane);
  },
};
