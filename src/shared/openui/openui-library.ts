// Adapted from selected AiRA code; see docs/HARNESS.md.
import type { StatementSpec } from "./openui-model.js";
export const OPENUI_LIBRARY = {
  Screens: { args: ["screens", "cursor"], required: 1, childArg: "screens" },
  Screen: { args: ["children", "seen"], required: 1, childArg: "children" },
  Text: { args: ["text", "variant", "color"], required: 1 },
  Keyword: { args: ["text", "caption", "color"], required: 1 },
  List: { args: ["items"], required: 1, childArg: "items" },
  ListItem: { args: ["text", "marker"], required: 1 },
  Alert: { args: ["tone", "text"], required: 2 },
  Timer: { args: ["label", "seconds", "image"], required: 2 },
  SetDots: { args: ["current", "total"], required: 2 },
  EffortPicker: { args: ["selected"], required: 1 },
  RestRing: { args: ["label", "seconds"], required: 2 },
  Cue: { args: ["text"], required: 1 },
  FollowUps: { args: ["prompts"], required: 1 },
} as const satisfies Record<string, StatementSpec>;
