import { describeSetupResult } from "../utils/setupResult.js";
import { timeAgo } from "../utils/format.js";
import InlineAlert from "./InlineAlert.jsx";

const SLOW_ANSWER_MS = 15000;

/**
 * Shows what the ESP32 itself said about the last config command (config/status).
 * `pending` = { baseline, startedAt }: the setup_reported_at value when the command was sent. While it is
 * unchanged the board has not answered yet (comparing server values avoids client/server clock skew).
 */
export default function CommandResult({ device, pending }) {
  if (pending && (device.setup_reported_at ?? null) === pending.baseline) {
    const slow = Date.now() - pending.startedAt > SLOW_ANSWER_MS;
    return (
      <InlineAlert tone="pending">
        {slow
          ? "Perangkat belum menjawab. Pastikan perangkat online dan terhubung ke broker."
          : "Perintah terkirim. Menunggu konfirmasi dari perangkat…"}
      </InlineAlert>
    );
  }
  const result = describeSetupResult(device.setup_result);
  if (!result) {
    return <p className="text-sm text-muted">Belum ada laporan konfigurasi dari perangkat ini.</p>;
  }
  return (
    <InlineAlert tone={result.success ? "success" : "danger"}>
      <p className="font-medium">{result.message}</p>
      {device.setup_detail && <p className="mt-0.5 break-words text-[13px] text-muted">{device.setup_detail}</p>}
      <p className="mt-0.5 text-[12px] text-muted">
        Operasi “{device.last_operation}” · dilaporkan {timeAgo(device.setup_reported_at)}
      </p>
    </InlineAlert>
  );
}
