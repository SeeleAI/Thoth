import type { Logger } from "pino";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import type { AgentSessionConfig } from "@thoth/drivers/agent-runtime";
import type { SpeechToTextProvider, TextToSpeechProvider } from "../../speech/speech-provider.js";
import type { Resolvable } from "../../speech/provider-resolver.js";
import type { SpeechReadinessSnapshot } from "../../speech/speech-runtime.js";
import type { TurnDetectionProvider } from "../../speech/turn-detection-provider.js";
import type { VoiceCallerContext, VoiceSpeakHandler } from "../../voice-types.js";

type VoiceAudioChunkMessage = Extract<SessionInboundMessage, { type: "voice_audio_chunk" }>;
type DictationStreamStartMessage = Extract<
  SessionInboundMessage,
  { type: "dictation_stream_start" }
>;

export interface VoiceSessionOptions {
  host: {
    emit: (msg: SessionOutboundMessage) => void;
    loadAgent: (agentId: string) => Promise<unknown>;
    reloadAgentSession: (
      agentId: string,
      overrides?: Partial<AgentSessionConfig>,
    ) => Promise<unknown>;
    sendSpokenInput: (agentId: string, text: string) => Promise<void>;
    interruptAgentIfRunning: (agentId: string) => Promise<unknown>;
    hasActiveAgentRun: (agentId: string) => boolean;
  };
  logger: Logger;
  sessionId: string;
  sttLanguage?: string;
  tts: Resolvable<TextToSpeechProvider | null>;
  stt: Resolvable<SpeechToTextProvider | null>;
  voice?: {
    turnDetection?: Resolvable<TurnDetectionProvider | null>;
  };
  voiceBridge?: {
    registerVoiceSpeakHandler?: (agentId: string, handler: VoiceSpeakHandler) => void;
    unregisterVoiceSpeakHandler?: (agentId: string) => void;
    registerVoiceCallerContext?: (agentId: string, context: VoiceCallerContext) => void;
    unregisterVoiceCallerContext?: (agentId: string) => void;
  };
  dictation?: {
    finalTimeoutMs?: number;
    stt?: Resolvable<SpeechToTextProvider | null>;
    sttLanguage?: string;
    getSpeechReadiness?: () => SpeechReadinessSnapshot;
  };
}

export class VoiceSession {
  private readonly logger: Logger;

  constructor(options: VoiceSessionOptions) {
    this.logger = options.logger;
  }

  isActiveForAgent(_agentId: string): boolean {
    return false;
  }

  async handleAudioChunk(_msg: VoiceAudioChunkMessage): Promise<void> {
    this.logger.debug("Voice audio chunk ignored because voice is disabled");
  }

  async handleAbort(): Promise<void> {}

  handleAudioPlayed(_id: string): void {}

  async handleSetVoiceMode(
    _enabled: boolean,
    _agentId: string | undefined,
    _requestId: string | undefined,
  ): Promise<void> {
    this.logger.debug("Voice mode request ignored because voice is disabled");
  }

  async handleDictationStreamStart(_msg: DictationStreamStartMessage): Promise<void> {
    this.logger.debug("Dictation stream ignored because dictation is disabled");
  }

  async handleDictationChunk(_input: {
    dictationId: string;
    seq: number;
    audioBase64: string;
    format?: string;
  }): Promise<void> {}

  async handleDictationFinish(_dictationId: string, _finalSeq?: number): Promise<void> {}

  handleDictationCancel(_dictationId: string): void {}

  async cleanup(): Promise<void> {}
}
