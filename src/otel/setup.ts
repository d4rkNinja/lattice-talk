import {
  context,
  diag,
  DiagLogLevel,
  propagation,
  SpanStatusCode,
  trace,
  type DiagLogger,
  type Span,
  type Tracer,
} from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import type { LatticeConfig } from "../core/config.js";
import { log } from "../log.js";

export interface OtelHandle {
  enabled: boolean;
  shutdown(): Promise<void>;
}

/** Never let the OTEL diag console logger write to stdout (MCP JSON-RPC). */
export function installOtelStderrLogger(): void {
  const stderrLogger: DiagLogger = {
    error: (message, ...args) => log("otel:error", message, ...args),
    warn: (message, ...args) => log("otel:warn", message, ...args),
    info: (message, ...args) => log("otel:info", message, ...args),
    debug: (message, ...args) => log("otel:debug", message, ...args),
    verbose: (message, ...args) => log("otel:verbose", message, ...args),
  };
  diag.setLogger(stderrLogger, DiagLogLevel.ERROR);
}

export function setupOtel(config: LatticeConfig): OtelHandle {
  installOtelStderrLogger();
  const endpoint = config.otelEndpoint;
  if (!endpoint) {
    return { enabled: false, shutdown: async () => undefined };
  }

  try {
    const url = endpoint.includes("/v1/traces")
      ? endpoint
      : `${endpoint.replace(/\/$/, "")}/v1/traces`;

    const resource = new Resource({
      [ATTR_SERVICE_NAME]: config.otelServiceName,
    });

    const exporter = new OTLPTraceExporter({
      url,
      headers: config.otelHeaders,
    });

    const provider = new NodeTracerProvider({
      resource,
      spanProcessors: [new BatchSpanProcessor(exporter)],
    });

    provider.register({
      propagator: new W3CTraceContextPropagator(),
    });
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());

    log("otel exporter enabled", url);
    return {
      enabled: true,
      async shutdown() {
        await provider.shutdown();
      },
    };
  } catch (err) {
    log("otel setup failed; continuing without traces", err instanceof Error ? err.message : err);
    return { enabled: false, shutdown: async () => undefined };
  }
}

export function getTracer(): Tracer {
  return trace.getTracer("lattice-mcp", "1.0.0");
}

export function currentTraceparent(): string | undefined {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier.traceparent || carrier.traceParent;
}

export interface SpanAttrs {
  sessionId?: string;
  agentId?: string;
  role?: string;
  displayName?: string;
  harness?: string;
  roomId?: string;
  namespace?: string;
}

export function applyLatticeAttrs(span: Span, attrs: SpanAttrs): void {
  const sessionId = attrs.sessionId ?? "";
  if (sessionId) {
    span.setAttribute("gen_ai.conversation.id", sessionId);
    span.setAttribute("lattice.session_id", sessionId);
  }
  if (attrs.agentId) span.setAttribute("lattice.agent_id", attrs.agentId);
  if (attrs.harness) span.setAttribute("lattice.harness", attrs.harness);
  if (attrs.roomId) span.setAttribute("lattice.room_id", attrs.roomId);
  if (attrs.namespace) span.setAttribute("lattice.namespace", attrs.namespace);
  const agentName = attrs.displayName || attrs.role;
  if (agentName) span.setAttribute("gen_ai.agent.name", agentName);
}

export async function withSpan<T>(
  name: string,
  attrs: SpanAttrs,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const tracer = getTracer();
  return tracer.startActiveSpan(`lattice.${name}`, async (span) => {
    try {
      applyLatticeAttrs(span, attrs);
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      span.recordException(message);
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      throw err;
    } finally {
      span.end();
    }
  });
}
