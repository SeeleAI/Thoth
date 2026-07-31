import type { IntentContractDraft } from "@thoth/protocol/intent-contract";
import type {
  ClarifyQuestionCard,
  ThothClarifyUpdateMapInput,
} from "@thoth/protocol/thoth-runtime-contract";

export interface ClarifyGoldenCard {
  card: ClarifyQuestionCard;
  eliminatedBranches: number;
  frontierNodes?: Array<
    Pick<ThothClarifyUpdateMapInput["nodes"][number], "id" | "owner" | "materiality" | "status">
  >;
  humanAction:
    | { intent: "submit_choices" }
    | { intent: "recommend" | "delegate_subtree"; targetNodeId: string };
}

export interface ClarifyGoldenScenario {
  id: string;
  title: string;
  strength: "light" | "balanced" | "dive";
  map: ThothClarifyUpdateMapInput;
  cards: ClarifyGoldenCard[];
  contract: IntentContractDraft;
  expected: {
    minimumHumanQuestions: number;
    maximumDiscoverableQuestions: number;
    challengerReopens: boolean;
  };
}

function question(
  nodeId: string,
  text: string,
  options: readonly [string, string, string, string?],
): ClarifyQuestionCard["questions"][number] {
  const [first, second, third, fourth] = options;
  const labels = [first, second, third, fourth].filter((value): value is string => Boolean(value));
  return {
    nodeId,
    question: text,
    selectionMode: "single",
    choices: labels.map((label, index) => ({
      id: `${nodeId}-choice-${index + 1}`,
      label,
      description: `Selecting ${label} changes the contract boundary.`,
    })),
    recommendedChoiceId: `${nodeId}-choice-1`,
  };
}

function card(
  title: string,
  questions: ClarifyQuestionCard["questions"],
  eliminatedBranches: number,
): ClarifyGoldenCard {
  return {
    card: {
      title,
      whyNow:
        "These parent decisions change the product boundary before their descendants can be inferred.",
      publicSummary: `Resolving ${questions.length} material decision branches.`,
      questions,
      allowChoiceNotes: true,
      allowNoteOnly: true,
      allowSubtreeDelegation: true,
    },
    eliminatedBranches,
    humanAction: { intent: "submit_choices" },
  };
}

const rayTracerHumanBranches = [
  [
    "target",
    "What is the primary product target?",
    "Offline renderer",
    "Interactive viewport",
    "Both",
  ],
  [
    "platform",
    "Which deployment platform is authoritative?",
    "Desktop GPU",
    "Workstation cluster",
    "Cloud service",
  ],
  [
    "latency",
    "Which performance objective dominates?",
    "Frame latency",
    "Throughput",
    "Image quality",
  ],
  [
    "scene-scale",
    "What scene scale must acceptance cover?",
    "Product scenes",
    "Film scenes",
    "Scientific scenes",
  ],
  [
    "fidelity",
    "Which physical fidelity boundary matters?",
    "PBR baseline",
    "Spectral",
    "Differentiable",
  ],
  [
    "integrator",
    "Which rendering result is required?",
    "Path tracing",
    "Bidirectional",
    "Hybrid raster",
  ],
  [
    "noise",
    "What convergence quality is acceptable?",
    "Interactive denoise",
    "Reference quality",
    "Configurable",
  ],
  [
    "hardware",
    "Which hardware compatibility is mandatory?",
    "Vendor neutral",
    "NVIDIA first",
    "Apple first",
  ],
  ["api", "What integration surface is required?", "Library API", "CLI renderer", "Editor plugin"],
  ["language", "Which public ABI boundary is required?", "C++17", "C API", "Rust API"],
  ["assets", "Which asset contract is mandatory?", "glTF", "USD", "Custom scene"],
  [
    "materials",
    "Which material model is authoritative?",
    "Metallic roughness",
    "MaterialX",
    "Custom BSDF",
  ],
  [
    "lighting",
    "Which lighting features define acceptance?",
    "Area and HDRI",
    "Full production",
    "Minimal core",
  ],
  [
    "geometry",
    "Which geometry envelope is mandatory?",
    "Triangles",
    "Curves and volume",
    "Procedural",
  ],
  [
    "animation",
    "What temporal support is required?",
    "Static",
    "Transform motion",
    "Deformation blur",
  ],
  ["memory", "What memory policy should dominate?", "Bounded VRAM", "Out of core", "Maximum speed"],
  [
    "determinism",
    "How strict must reproducibility be?",
    "Bit stable",
    "Statistical",
    "Best effort",
  ],
  [
    "precision",
    "Which numerical precision boundary matters?",
    "FP32",
    "Mixed precision",
    "Reference FP64",
  ],
  [
    "errors",
    "How should unsupported scenes fail?",
    "Hard reject",
    "Visible fallback",
    "Partial render",
  ],
  [
    "security",
    "What input trust boundary applies?",
    "Trusted assets",
    "Untrusted files",
    "Sandboxed service",
  ],
  [
    "benchmark",
    "Which comparison baseline decides performance?",
    "Embree",
    "OptiX",
    "Existing renderer",
  ],
  [
    "quality-metric",
    "Which image metric decides fidelity?",
    "Reference RMSE",
    "Perceptual",
    "Visual review",
  ],
  [
    "test-scenes",
    "Who owns the acceptance scene corpus?",
    "Repository corpus",
    "Public corpus",
    "User corpus",
  ],
  [
    "profiling",
    "Which bottleneck evidence is required?",
    "GPU timing",
    "End to end",
    "Both CPU and GPU",
  ],
  [
    "compatibility",
    "How much existing API compatibility is required?",
    "Strict",
    "Source only",
    "Redesign allowed",
  ],
  [
    "incremental",
    "What delivery strategy is acceptable?",
    "Vertical slices",
    "Complete core",
    "Research prototype",
  ],
  [
    "observability",
    "What runtime observability is required?",
    "Counters",
    "Trace capture",
    "Debug UI",
  ],
  [
    "cache",
    "What persistence policy applies to acceleration data?",
    "Memory only",
    "Disk cache",
    "Distributed cache",
  ],
  ["multi-gpu", "Is multi-GPU execution part of acceptance?", "No", "Single host", "Cluster"],
  [
    "licensing",
    "What dependency licensing boundary applies?",
    "Permissive only",
    "Copyleft allowed",
    "No dependencies",
  ],
  [
    "completion",
    "Who confirms final completion?",
    "Automatic evidence",
    "Human final review",
    "Both",
  ],
  [
    "risk",
    "Which irreversible risk requires explicit approval?",
    "Architecture",
    "Dependency",
    "Performance tradeoff",
  ],
] as const;

const rayTracerNodes: ThothClarifyUpdateMapInput["nodes"] = rayTracerHumanBranches.map(
  ([id, title], index) => ({
    id,
    parentIds:
      index === 0
        ? []
        : index < 4
          ? ["target"]
          : [rayTracerHumanBranches[Math.floor((index - 1) / 4)]![0]],
    title,
    owner: "human",
    materiality: index < 8 ? "structural" : "material",
    status: "awaiting_human",
    resolutionRef: null,
    sourceRefs: [],
  }),
);

const rayTracerCards: ClarifyGoldenCard[] = [];
for (let index = 0; index < rayTracerHumanBranches.length; index += 4) {
  const group = rayTracerHumanBranches.slice(index, index + 4);
  rayTracerCards.push(
    card(
      `Ray tracer decisions ${index + 1}-${index + group.length}`,
      group.map(([id, text, first, second, third]) => question(id, text, [first, second, third])),
      group.length * 3,
    ),
  );
}

export const CLARIFY_GOLDEN_SCENARIOS: ClarifyGoldenScenario[] = [
  {
    id: "discover-before-ask",
    title: "Workspace facts remain Evidence-owned",
    strength: "light",
    map: {
      effectiveStrength: "light",
      publicSummary:
        "The repository determines language and build system; only acceptance remains Human-owned.",
      nodes: [
        {
          id: "language",
          parentIds: [],
          title: "Repository language",
          owner: "evidence",
          materiality: "structural",
          status: "resolved",
          resolutionRef: "evidence:package-json",
          sourceRefs: ["workspace:package.json"],
        },
        {
          id: "acceptance",
          parentIds: [],
          title: "Acceptance boundary",
          owner: "human",
          materiality: "structural",
          status: "delegated",
          resolutionRef: "decision:acceptance-recommended",
          sourceRefs: [],
        },
      ],
    },
    cards: [
      {
        ...card(
          "Acceptance",
          [
            question("acceptance", "What outcome proves this request complete?", [
              "Behavior",
              "Performance",
              "Both",
            ]),
          ],
          3,
        ),
        frontierNodes: [
          {
            id: "acceptance",
            owner: "human",
            materiality: "structural",
            status: "awaiting_human",
          },
        ],
        humanAction: { intent: "recommend", targetNodeId: "acceptance" },
      },
    ],
    contract: {
      title: "Repository-aligned implementation",
      objective: "Implement the requested behavior in the existing repository architecture.",
      nonGoals: ["Replace the repository toolchain"],
      invariants: ["Use the repository language and build system"],
      acceptance: ["The selected behavior and performance boundary are evidenced"],
      riskBoundary: [],
      humanDecisionRefs: ["decision:acceptance"],
      escalationPolicy: {
        returnToHumanWhen: ["Acceptance changes"],
        finalConfirmation: "automatic",
      },
    },
    expected: {
      minimumHumanQuestions: 1,
      maximumDiscoverableQuestions: 0,
      challengerReopens: false,
    },
  },
  {
    id: "delegate-subtree",
    title: "A parent choice lets the Agent solve implementation descendants",
    strength: "balanced",
    map: {
      effectiveStrength: "balanced",
      publicSummary: "The human chooses portability; implementation descendants are delegated.",
      nodes: [
        {
          id: "portability",
          parentIds: [],
          title: "Portability boundary",
          owner: "human",
          materiality: "structural",
          status: "delegated",
          resolutionRef: "decision:portable",
          sourceRefs: [],
        },
        {
          id: "adapter-layout",
          parentIds: ["portability"],
          title: "Adapter layout",
          owner: "agent",
          materiality: "local",
          status: "resolved",
          resolutionRef: "agent:provider-neutral-adapter",
          sourceRefs: ["decision:portable"],
        },
      ],
    },
    cards: [
      {
        ...card(
          "Portability",
          [
            question("portability", "Which portability boundary should the system preserve?", [
              "All providers",
              "One provider",
              "ACP only",
            ]),
          ],
          6,
        ),
        frontierNodes: [
          {
            id: "portability",
            owner: "human",
            materiality: "structural",
            status: "awaiting_human",
          },
        ],
        humanAction: { intent: "delegate_subtree", targetNodeId: "portability" },
      },
    ],
    contract: {
      title: "Provider-neutral feature",
      objective: "Deliver the feature through one provider-neutral adapter contract.",
      nonGoals: ["Provider-specific business branches"],
      invariants: ["All supported providers consume the same semantic contract"],
      acceptance: ["Adapter conformance proves equivalent behavior"],
      riskBoundary: ["No fallback transport"],
      humanDecisionRefs: ["decision:portable"],
      escalationPolicy: {
        returnToHumanWhen: ["Portability changes"],
        finalConfirmation: "automatic",
      },
    },
    expected: {
      minimumHumanQuestions: 1,
      maximumDiscoverableQuestions: 0,
      challengerReopens: false,
    },
  },
  {
    id: "ray-tracer-dive-32",
    title: "Dive recursively asks more than thirty material ray tracer decisions",
    strength: "dive",
    map: {
      effectiveStrength: "dive",
      publicSummary: "A broad rendering product contains many independent high-impact forks.",
      nodes: rayTracerNodes,
    },
    cards: rayTracerCards,
    contract: {
      title: "High-performance ray tracer",
      objective:
        "Build the confirmed production ray tracing product for the selected target and platform.",
      nonGoals: ["Unconfirmed rendering domains"],
      invariants: ["Preserve selected platform, fidelity, API, and safety boundaries"],
      acceptance: [
        "Selected scene corpus renders correctly",
        "Selected quality metric meets its threshold",
        "Selected performance baseline is met",
      ],
      riskBoundary: [
        "Architecture, dependency, and performance tradeoffs follow confirmed decisions",
      ],
      humanDecisionRefs: rayTracerHumanBranches.map(([id]) => `decision:${id}`),
      escalationPolicy: {
        returnToHumanWhen: ["Any structural Decision Map node changes"],
        finalConfirmation: "required",
      },
    },
    expected: {
      minimumHumanQuestions: 30,
      maximumDiscoverableQuestions: 0,
      challengerReopens: false,
    },
  },
];
