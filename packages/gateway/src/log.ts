export type LogSink = (line: string) => void;

export function writeLog(sink: LogSink, event: Record<string, string | number | boolean | null>): void {
  sink(JSON.stringify({ time: new Date().toISOString(), ...event }));
}
