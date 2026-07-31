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

export interface ClarifyGoldenTransition {
  cardTitle: string;
  answeredNodeIds: string[];
  resolvedNodeIds: string[];
  delegatedNodeIds: string[];
  prunedRouteRefs: string[];
  newlyMaterialNodeIds: string[];
}

export interface ClarifyGoldenScenario {
  id: string;
  title: string;
  strength: "light" | "balanced" | "dive";
  rootNodeId: string;
  map: ThothClarifyUpdateMapInput;
  cards: ClarifyGoldenCard[];
  transitions: ClarifyGoldenTransition[];
  contract: IntentContractDraft;
  humanOwnershipRationale: Record<string, string>;
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
      allowSingleNodeRecommendation: true,
      allowSubtreeDelegation: true,
    },
    eliminatedBranches,
    humanAction: { intent: "submit_choices" },
  };
}

interface RayTracerHumanBranch {
  id: string;
  groupId: string;
  question: string;
  options: readonly [string, string, string];
  rationale: string;
}

const rayTracerGroups = [
  ["ray-product", "Product and delivery envelope"],
  ["ray-visual", "Visual quality boundary"],
  ["ray-integration", "Interoperability boundary"],
  ["ray-runtime", "Runtime capacity boundary"],
  ["ray-safety", "Safety and compatibility boundary"],
  ["ray-proof", "Acceptance and evidence boundary"],
  ["ray-operations", "Operations and delivery boundary"],
  ["ray-governance", "Cost, approval and data boundary"],
] as const;

const rayTracerHumanBranches: readonly RayTracerHumanBranch[] = [
  {
    id: "target",
    groupId: "ray-product",
    question: "What user-facing product target is authoritative?",
    options: ["Offline renderer", "Interactive viewport", "Both"],
    rationale: "Changes the user-visible product and all downstream acceptance claims.",
  },
  {
    id: "platform",
    groupId: "ray-product",
    question: "Which user deployment environment must be supported?",
    options: ["Desktop GPU", "Workstation cluster", "Cloud service"],
    rationale: "Changes the supported operating environment and cost boundary.",
  },
  {
    id: "latency",
    groupId: "ray-product",
    question: "Which experience tradeoff dominates acceptance?",
    options: ["Frame latency", "Batch throughput", "Image quality"],
    rationale:
      "Selects a user value tradeoff that cannot be inferred from implementation practice.",
  },
  {
    id: "scene-scale",
    groupId: "ray-product",
    question: "What scene scale must acceptance cover?",
    options: ["Product scenes", "Film scenes", "Scientific scenes"],
    rationale: "Defines the real acceptance corpus and resource envelope.",
  },
  {
    id: "fidelity",
    groupId: "ray-visual",
    question: "Which visual fidelity boundary matters to users?",
    options: ["PBR baseline", "Spectral look", "Differentiable output"],
    rationale: "Changes the externally visible rendering promise.",
  },
  {
    id: "noise",
    groupId: "ray-visual",
    question: "What convergence quality is acceptable?",
    options: ["Interactive denoise", "Reference quality", "Configurable"],
    rationale: "Defines the quality versus responsiveness promise.",
  },
  {
    id: "lighting",
    groupId: "ray-visual",
    question: "Which lighting feature envelope defines acceptance?",
    options: ["Area and HDRI", "Full production", "Minimal core"],
    rationale: "Changes what authored scenes users can rely on.",
  },
  {
    id: "quality-metric",
    groupId: "ray-visual",
    question: "Which image quality proof is authoritative?",
    options: ["Reference RMSE", "Perceptual score", "Visual review"],
    rationale: "Defines how the user accepts or rejects the finished product.",
  },
  {
    id: "api",
    groupId: "ray-integration",
    question: "Which integration product surface is required?",
    options: ["Library API", "CLI renderer", "Editor plugin"],
    rationale: "Changes the public product surface rather than an internal implementation detail.",
  },
  {
    id: "abi",
    groupId: "ray-integration",
    question: "What public integration compatibility must be promised?",
    options: ["Stable C ABI", "Language SDK", "No stable ABI"],
    rationale: "Defines a long-lived compatibility commitment to users and integrators.",
  },
  {
    id: "assets",
    groupId: "ray-integration",
    question: "Which asset contract is mandatory?",
    options: ["glTF", "USD", "Custom scene"],
    rationale: "Changes which user assets are in the supported product boundary.",
  },
  {
    id: "materials",
    groupId: "ray-integration",
    question: "Which material interchange boundary is required?",
    options: ["Metallic roughness", "MaterialX", "Custom BSDF"],
    rationale: "Changes authored-content interoperability and acceptance scenes.",
  },
  {
    id: "geometry",
    groupId: "ray-runtime",
    question: "Which geometry envelope is mandatory?",
    options: ["Triangles", "Curves and volume", "Procedural"],
    rationale: "Defines which real workloads must be supported.",
  },
  {
    id: "animation",
    groupId: "ray-runtime",
    question: "What temporal support is required?",
    options: ["Static", "Transform motion", "Deformation blur"],
    rationale: "Changes the user-visible scene capability and performance envelope.",
  },
  {
    id: "capacity",
    groupId: "ray-runtime",
    question: "What deployment capacity boundary is non-negotiable?",
    options: ["Fits 12 GB", "Fits 24 GB", "Out-of-core allowed"],
    rationale: "Defines a user-owned hardware and operating-cost constraint.",
  },
  {
    id: "determinism",
    groupId: "ray-runtime",
    question: "How strict must reproducibility be?",
    options: ["Bit stable", "Statistical", "Best effort"],
    rationale: "Defines the reproducibility promise needed by the user workflow.",
  },
  {
    id: "numeric-reproducibility",
    groupId: "ray-safety",
    question: "What numeric result guarantee must acceptance show?",
    options: ["Repeatable numeric", "Perceptual match", "Maximum speed"],
    rationale: "Chooses a product-quality guarantee, not a low-level arithmetic implementation.",
  },
  {
    id: "errors",
    groupId: "ray-safety",
    question: "How should unsupported scenes behave?",
    options: ["Hard reject", "Visible warning", "Partial render"],
    rationale: "Defines an externally visible safety and failure contract.",
  },
  {
    id: "security",
    groupId: "ray-safety",
    question: "What input trust boundary applies?",
    options: ["Trusted assets", "Untrusted files", "Sandboxed service"],
    rationale: "Sets a risk boundary that must be explicitly owned by the user.",
  },
  {
    id: "compatibility",
    groupId: "ray-safety",
    question: "How much existing integration compatibility is required?",
    options: ["Strict", "Source only", "Redesign allowed"],
    rationale: "Changes migration cost and the compatibility promise.",
  },
  {
    id: "licensing",
    groupId: "ray-proof",
    question: "What dependency licensing boundary applies?",
    options: ["Permissive only", "Copyleft allowed", "No dependencies"],
    rationale: "Sets a legal and distribution constraint the Agent cannot infer.",
  },
  {
    id: "performance-target",
    groupId: "ray-proof",
    question: "Which externally visible performance target defines success?",
    options: ["Embree class", "OptiX class", "Existing tool"],
    rationale: "Defines the comparison the user will accept as meaningful performance evidence.",
  },
  {
    id: "test-scenes",
    groupId: "ray-proof",
    question: "Who owns the acceptance scene corpus?",
    options: ["Repository corpus", "Public corpus", "User corpus"],
    rationale: "Defines the evidence source and real-world acceptance boundary.",
  },
  {
    id: "profiling",
    groupId: "ray-proof",
    question: "Which performance evidence is required?",
    options: ["GPU timing", "End to end", "CPU and GPU"],
    rationale: "Defines the observable proof the user needs before accepting a claim.",
  },
  {
    id: "observability",
    groupId: "ray-operations",
    question: "What runtime observability is required?",
    options: ["Counters", "Trace capture", "Debug UI"],
    rationale: "Changes the operator-facing product capability.",
  },
  {
    id: "delivery",
    groupId: "ray-operations",
    question: "What delivery strategy is acceptable?",
    options: ["Vertical slices", "Complete core", "Research prototype"],
    rationale: "Sets a user-owned sequencing and risk tolerance boundary.",
  },
  {
    id: "cache",
    groupId: "ray-operations",
    question: "What acceleration-data persistence policy applies?",
    options: ["Memory only", "Disk cache", "Distributed cache"],
    rationale: "Changes durability, cost, and privacy behavior visible to operators.",
  },
  {
    id: "multi-gpu",
    groupId: "ray-operations",
    question: "Is multi-GPU execution part of acceptance?",
    options: ["No", "Single host", "Cluster"],
    rationale: "Defines a product-scale commitment and acceptance workload.",
  },
  {
    id: "operating-cost",
    groupId: "ray-governance",
    question: "Which operating-cost boundary must be protected?",
    options: ["Fixed workstation", "Elastic cloud", "Budget capped"],
    rationale: "Sets a human-owned economic constraint.",
  },
  {
    id: "completion",
    groupId: "ray-governance",
    question: "Who confirms final completion?",
    options: ["Automatic evidence", "Human final review", "Both"],
    rationale: "Defines the user's final completion authority.",
  },
  {
    id: "risk",
    groupId: "ray-governance",
    question: "Which irreversible risk requires explicit approval?",
    options: ["Architecture", "Dependency", "Performance tradeoff"],
    rationale: "Sets an escalation boundary that cannot be chosen by the Agent alone.",
  },
  {
    id: "data-handling",
    groupId: "ray-governance",
    question: "What data-handling boundary applies to user scenes?",
    options: ["Local only", "Opt-in export", "Service managed"],
    rationale: "Defines privacy and deployment policy under human authority.",
  },
];

const rayTracerNodes: ThothClarifyUpdateMapInput["nodes"] = [
  {
    id: "ray-objective",
    parentId: null,
    crossLinkIds: [],
    title: "High-performance ray tracer objective",
    summary:
      "The user requested a production ray tracing product; its material boundaries remain to be clarified.",
    owner: "human",
    materiality: "structural",
    status: "resolved",
    resolutionRef: "user:ray-tracer-objective",
    sourceRefs: ["user:objective"],
  },
  ...rayTracerGroups.map(([id, title]) => ({
    id,
    parentId: "ray-objective",
    crossLinkIds: [],
    title,
    summary: "Agent-organized structural group for related user-owned decisions.",
    owner: "agent" as const,
    materiality: "structural" as const,
    status: "resolved" as const,
    resolutionRef: `agent:${id}:grouped`,
    sourceRefs: ["agent:tree-organization"],
  })),
  ...rayTracerHumanBranches.map((branch) => ({
    id: branch.id,
    parentId: branch.groupId,
    crossLinkIds: [],
    title: branch.question,
    summary: branch.rationale,
    owner: "human" as const,
    materiality: "material" as const,
    status: "awaiting_human" as const,
    resolutionRef: null,
    sourceRefs: [],
  })),
];

const rayTracerCards: ClarifyGoldenCard[] = [];
for (let index = 0; index < rayTracerHumanBranches.length; index += 4) {
  const group = rayTracerHumanBranches.slice(index, index + 4);
  rayTracerCards.push(
    card(
      `Ray tracer decisions ${index + 1}-${index + group.length}`,
      group.map((branch) => question(branch.id, branch.question, branch.options)),
      group.length * 2,
    ),
  );
}

const rayTracerTransitions: ClarifyGoldenTransition[] = rayTracerCards.map((entry, index) => {
  const answeredNodeIds = entry.card.questions.map((question) => question.nodeId);
  return {
    cardTitle: entry.card.title,
    answeredNodeIds,
    resolvedNodeIds: answeredNodeIds,
    delegatedNodeIds: [],
    prunedRouteRefs: entry.card.questions.flatMap((question) =>
      question.choices.slice(1).map((choice) => `${question.nodeId}:${choice.id}`),
    ),
    newlyMaterialNodeIds:
      rayTracerCards[index + 1]?.card.questions.map((question) => question.nodeId) ?? [],
  };
});

export const CLARIFY_GOLDEN_SCENARIOS: ClarifyGoldenScenario[] = [
  {
    id: "discover-before-ask",
    title: "Workspace facts remain Evidence-owned",
    strength: "light",
    rootNodeId: "discover-objective",
    map: {
      effectiveStrength: "light",
      activity: "investigating",
      activeNodeId: "acceptance",
      publicSummary:
        "The repository determines language and build system; only acceptance remains Human-owned.",
      nodes: [
        {
          id: "discover-objective",
          parentId: null,
          crossLinkIds: [],
          title: "Repository-aligned implementation objective",
          summary: "The user asked for implementation within the existing repository.",
          owner: "human",
          materiality: "structural",
          status: "resolved",
          resolutionRef: "user:repository-objective",
          sourceRefs: ["user:objective"],
        },
        {
          id: "language",
          parentId: "discover-objective",
          crossLinkIds: [],
          title: "Repository language",
          summary: "Resolved from the repository toolchain.",
          owner: "evidence",
          materiality: "structural",
          status: "resolved",
          resolutionRef: "evidence:package-json",
          sourceRefs: ["workspace:package.json"],
        },
        {
          id: "acceptance",
          parentId: "discover-objective",
          crossLinkIds: ["language"],
          title: "Acceptance boundary",
          summary: "Waiting for the Human-owned acceptance boundary.",
          owner: "human",
          materiality: "structural",
          status: "awaiting_human",
          resolutionRef: null,
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
    transitions: [
      {
        cardTitle: "Acceptance",
        answeredNodeIds: ["acceptance"],
        resolvedNodeIds: [],
        delegatedNodeIds: ["acceptance"],
        prunedRouteRefs: [
          "acceptance:implementation-only",
          "acceptance:performance-only",
          "acceptance:unbounded",
        ],
        newlyMaterialNodeIds: [],
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
    humanOwnershipRationale: {
      acceptance:
        "The completion boundary expresses user value and cannot be recovered from Workspace evidence.",
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
    rootNodeId: "delegate-objective",
    map: {
      effectiveStrength: "balanced",
      activity: "expanding",
      activeNodeId: "portability",
      publicSummary: "The human chooses portability; implementation descendants are delegated.",
      nodes: [
        {
          id: "delegate-objective",
          parentId: null,
          crossLinkIds: [],
          title: "Provider-neutral feature objective",
          summary: "The user wants one provider-neutral product boundary.",
          owner: "human",
          materiality: "structural",
          status: "resolved",
          resolutionRef: "user:provider-neutral-objective",
          sourceRefs: ["user:objective"],
        },
        {
          id: "portability",
          parentId: "delegate-objective",
          crossLinkIds: [],
          title: "Portability boundary",
          summary: "Waiting for the Human-owned portability boundary.",
          owner: "human",
          materiality: "structural",
          status: "awaiting_human",
          resolutionRef: null,
          sourceRefs: [],
        },
        {
          id: "adapter-layout",
          parentId: "portability",
          crossLinkIds: [],
          title: "Adapter layout",
          summary:
            "Wait for the confirmed portability boundary before resolving the adapter layout.",
          owner: "agent",
          materiality: "local",
          status: "open",
          resolutionRef: null,
          sourceRefs: [],
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
    transitions: [
      {
        cardTitle: "Portability",
        answeredNodeIds: ["portability"],
        resolvedNodeIds: [],
        delegatedNodeIds: ["portability", "adapter-layout"],
        prunedRouteRefs: [
          "portability:one-provider-only",
          "portability:acp-only",
          "portability:provider-branch",
          "portability:parallel-business-path",
          "portability:adapter-layout-duplication",
          "portability:transport-fallback",
        ],
        newlyMaterialNodeIds: [],
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
    humanOwnershipRationale: {
      portability:
        "The portability promise changes the product boundary, compatibility cost, and future provider commitments.",
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
    rootNodeId: "ray-objective",
    map: {
      effectiveStrength: "dive",
      activity: "expanding",
      activeNodeId: "target",
      publicSummary: "A broad rendering product contains many independent high-impact forks.",
      nodes: rayTracerNodes,
    },
    cards: rayTracerCards,
    transitions: rayTracerTransitions,
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
      humanDecisionRefs: rayTracerHumanBranches.map((branch) => `decision:${branch.id}`),
      escalationPolicy: {
        returnToHumanWhen: ["Any structural Decision Tree node changes"],
        finalConfirmation: "required",
      },
    },
    humanOwnershipRationale: Object.fromEntries(
      rayTracerHumanBranches.map((branch) => [branch.id, branch.rationale]),
    ),
    expected: {
      minimumHumanQuestions: 30,
      maximumDiscoverableQuestions: 0,
      challengerReopens: false,
    },
  },
];
