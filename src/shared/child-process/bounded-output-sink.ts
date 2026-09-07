import { Buffer } from 'node:buffer'

/**
 * Collects output up to a cap, so a chatty child cannot grow the heap.
 *
 * Accepts strings as well as buffers: a stream someone called `setEncoding` on
 * emits strings, and concatenating those as buffers throws inside a `data`
 * handler, where the rejection has nowhere to go and the caller just hangs.
 */
export function createOutputSink(maxBytes: number): {
  write: (chunk: Buffer | string) => void
  text: () => string
  buffer: () => Buffer
  truncated: () => boolean
} {
  const chunks: Buffer[] = []
  let bytes = 0
  return {
    write(raw) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
      const remaining = maxBytes - bytes
      if (remaining <= 0) {
        bytes += chunk.length
        return
      }
      // Copy retained bytes so a short view cannot keep a much larger source buffer alive.
      chunks.push(Buffer.from(chunk.subarray(0, Math.min(chunk.length, remaining))))
      bytes += chunk.length
    },
    text: () => Buffer.concat(chunks).toString('utf8'),
    buffer: () => Buffer.concat(chunks),
    // Why: callers that parse the output need to tell a short answer from a
    // clipped one -- truncated JSON or JSONL parses as a smaller valid result.
    truncated: () => bytes > maxBytes
  }
}
